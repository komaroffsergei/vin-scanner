"""Materialize pinned, same-origin runtime assets. Never download user images."""
import hashlib
import json
import pathlib
import shutil
import urllib.request
import zipfile

APP = pathlib.Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
MODULES = ROOT / 'node_modules'
OUT = APP / 'public/assets'
OUT.mkdir(parents=True, exist_ok=True)
records = []


def record(path, source, version, license_name):
    data = path.read_bytes()
    records.append({'path': path.relative_to(OUT).as_posix(), 'source': source,
                    'version': version, 'license': license_name, 'bytes': len(data),
                    'sha256': hashlib.sha256(data).hexdigest()})


def copy(source, relative, package, version, license_name):
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    record(target, package, version, license_name)


def instrument_worker(relative):
    target = OUT / relative
    observer = (ROOT / 'packages/vin-scanner/src/worker/resource-observer.js').read_text(encoding='utf-8')
    target.write_text(observer + '\n' + target.read_text(encoding='utf-8'), encoding='utf-8')
    entry = next(item for item in records if item['path'] == relative)
    entry['sourceSha256'] = entry['sha256']
    entry['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    entry['bytes'] = target.stat().st_size
    entry['instrumentation'] = 'Resource timing count only; official OCR code unchanged'


def download(url, relative, expected_hash, version, license_name):
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != expected_hash:
        with urllib.request.urlopen(url, timeout=90) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise ValueError('Asset integrity mismatch: ' + relative)
        target.write_bytes(data)
    record(target, url, version, license_name)


models = ROOT / 'packages/vin-scanner/models'
EXPECTED_NATIVE = {'vin_detector.onnx': 'b150fb0ac78d89d32477014b0f0a5aa0d7e5c8d18ce67dc8456e6e60468503a0', 'ppocr-rec.onnx': '466d2b8a9320162638a146167bba096330582d46c163015d77eff1a2f1caaca0', 'vin_dict.txt': 'e2e0d35afd6bb6dc3f4b38362f076b0bbb3abf2ac6a3453070de4d28f590d9bb', 'vin_ngram.json': '654babb8b8a34c3b5e44918854df74e86b0dab7db3a41faf12623ec48e85683b'}
for name, digest in EXPECTED_NATIVE.items():
    if hashlib.sha256((models / name).read_bytes()).hexdigest() != digest:
        raise ValueError('Native model integrity mismatch: ' + name)
for name in ['vin_detector.onnx', 'ppocr-rec.onnx', 'vin_dict.txt', 'vin_ngram.json']:
    copy(models / name, 'native/' + name, 'vin-scanner@a9288bb3668633906df657aed29e908dddbe691e', '0.1.1', 'AGPL-3.0-only; see NOTICE')
for package, folder, version, stem in [('onnxruntime-web', 'native', '1.24.2', 'ort-wasm-simd-threaded'),
                                        ('ort-paddle', 'paddle', '1.24.3', 'ort-wasm-simd-threaded.jsep')]:
    package_root = ROOT / 'packages/vin-scanner/node_modules/onnxruntime-web' if folder == 'native' else MODULES / package
    if not package_root.exists():
        package_root = MODULES / package
    if json.loads((package_root / 'package.json').read_text(encoding='utf-8'))['version'] != version:
        raise ValueError('Runtime version mismatch: ' + folder)
    for extension in ['wasm', 'mjs']:
        copy(package_root / 'dist' / (stem + '.' + extension), folder + '/' + stem + '.' + extension,
             'onnxruntime-web', version, 'MIT')
paddle = MODULES / '@paddleocr/paddleocr-js'
worker = next((paddle / 'dist/assets').glob('worker-entry-*.js'))
copy(worker, 'paddle/worker.js', '@paddleocr/paddleocr-js', '0.4.2', 'Apache-2.0; bundled OpenCV and ORT notices preserved')
instrument_worker('paddle/worker.js')
base = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/'
for kind, digest in [('det', 'ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d'),
                     ('rec', '1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29')]:
    name = 'PP-OCRv6_tiny_' + kind + '_onnx_infer.tar'
    download(base + name, 'paddle/' + name, digest, 'PP-OCRv6_tiny', 'Apache-2.0')
for name in ['tesseract.esm.min.js', 'worker.min.js']:
    copy(MODULES / 'tesseract.js/dist' / name, 'tesseract/' + name, 'tesseract.js', '7.0.0', 'Apache-2.0')
instrument_worker('tesseract/worker.min.js')
for source in (MODULES / 'tesseract.js-core').glob('*lstm*'):
    if source.suffix in ['.js', '.wasm']:
        copy(source, 'tesseract/core/' + source.name, 'tesseract.js-core', '7.0.0', 'Apache-2.0')
language = MODULES / '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
copy(language, 'tesseract/lang/eng.traineddata.gz', '@tesseract.js-data/eng', '1.0.0 / 4.0.0_best_int', 'Apache-2.0 trained data; MIT packaging')
for package in ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', 'onnxruntime-web', 'ort-paddle', '@techstark/opencv-js']:
    for path in (MODULES / package).glob('*LICENSE*'):
        if path.is_file():
            copy(path, 'licenses/' + package.replace('/', '-') + '-' + path.name, package, 'see lockfile', 'see file')
for name in ['LICENSE', 'NOTICE.md']:
    copy(ROOT / name, 'licenses/vin-scanner-' + name, 'vin-scanner', '0.1.1', 'AGPL-3.0-only; see NOTICE')
fixture_manifest = json.loads((APP / 'fixtures/manifest.json').read_text(encoding='utf-8'))
for fixture in fixture_manifest['cases']:
    source = APP / 'fixtures/images' / (fixture['caseId'] + '.png')
    if hashlib.sha256(source.read_bytes()).hexdigest() != fixture['sha256']:
        raise ValueError('Fixture integrity mismatch: ' + fixture['caseId'])
    copy(source, fixture['file'], 'deterministic synthetic generator / seed 0x77107731', 'vin-synthetic-v1', 'Synthetic test data')
copy(APP / 'fixtures/manifest.json', 'fixtures/manifest.json', 'diagnostics synthetic generator', 'vin-synthetic-v1', 'Synthetic test data')
copy(APP / 'fixtures/LICENSE-DejaVu.html', 'licenses/LICENSE-DejaVu.html', 'https://dejavu-fonts.github.io/License.html', 'DejaVu Fonts', 'See license file')
with zipfile.ZipFile(OUT / 'vin-synthetic-v1.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for source in sorted((OUT / 'fixtures').iterdir()):
        archive.write(source, source.name)
record(OUT / 'vin-synthetic-v1.zip', 'diagnostics canonical fixtures', 'vin-synthetic-v1', 'Synthetic test data')
(APP / 'assets-manifest.json').write_text(json.dumps({'schemaVersion': 1, 'resources': records}, indent=2) + '\n', encoding='utf-8')
shutil.copyfile(APP / 'assets-manifest.json', OUT / 'assets-manifest.json')
print(json.dumps({'resources': len(records), 'bytes': sum(item['bytes'] for item in records)}))
