from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'extension' / 'manifest.json').read_text())['version']
target = root / 'dist' / f'cs128-vim-{version}.zip'
target.parent.mkdir(exist_ok=True)
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for file in sorted((root / 'extension').iterdir()):
        if file.is_file():
            archive.write(file, 'cs128-vim/' + file.name)
    archive.write(root / 'README.md', 'cs128-vim/README.md')
print(target)
