"""Package the locally built Modern Art project without runtime secrets."""
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
required = ['dist/index.html', 'server/index.js', 'src/main.js', 'package.json',
            'package-lock.json', 'packages/a3game-playable/package.json',
            'packages/modern-art/package.json']
for item in required:
    if not (root / item).is_file():
        raise SystemExit(f'Missing {item}; build the project first')
excluded = {'node_modules', '.data', '.a3game', 'evidence', 'release', '.git', '__pycache__'}
args.output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.output, 'x', ZIP_DEFLATED) as archive:
    # Required by the lockfile's local file dependency layout; never copy tokens.
    archive.writestr('modern-art/.npmrc', 'install-links=true\n')
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if any(part in excluded for part in rel.parts):
            continue
        if path.is_symlink() or not path.is_file():
            continue
        if path.name.startswith('.env') or path.suffix.lower() in {'.log', '.pem', '.key', '.zip'}:
            continue
        if path.name == '.npmrc':
            continue  # Remote registry is passed explicitly; never package tokens.
        archive.write(path, Path('modern-art') / rel)
with ZipFile(args.output) as archive:
    assert archive.testzip() is None
    for item in required:
        assert 'modern-art/' + item in archive.namelist()
print(args.output.resolve())
print('SHA256 ' + hashlib.sha256(args.output.read_bytes()).hexdigest())
print('Bytes ' + str(args.output.stat().st_size))
