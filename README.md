# Ear Check

An offline progressive web app (PWA) that screens eardrum photos taken through a smartphone otoscope clip. A small neural network runs entirely in the browser: no server, no upload, no internet needed after the first load.

**Live demo:** https://refrigerator2.github.io/ear-check/  
(Open in browser on phone, then *Share → Add to Home Screen*.)

> **Educational prototype. Not a medical device and not a diagnosis.**

## What it does

1. The user takes a photo or picks one from the library.
2. The central part of the image is cropped, resized to 224×224 and passed to a MobileNetV3-Small classifier running in WebAssembly (onnxruntime-web).
3. The model scores six conditions, and the app turns the scores into one of four plain-language outcomes:

| Outcome | Shown when |
|---|---|
| **No signs of an ear problem detected** | *Normal* is the top class with confidence ≥ 0.6 |
| **See a doctor** | top class is acute otitis media, chronic otitis media or otitis externa |
| **Keep an eye on it** | top class is tympanosclerosis, or the result is unclear |
| **View blocked, clean and retake** | top class is earwax |

"No signs" is deliberately hard to get: a false "all clear" is the most harmful mistake, so anything short of a confident *Normal* is not reported as healthy. The 0.6 threshold was chosen on the validation set (higher values only added false alarms without catching more disease).

## Results

Held-out test split (139 images, 15 %), stratified, not used for training or threshold selection.

| Class | Precision | Recall | Test images |
|---|---|---|---|
| Acute otitis media | 0.43 | 0.56 | 18 |
| Chronic otitis media | 0.88 | 0.70 | 10 |
| Earwax | 0.78 | 0.67 | 21 |
| Normal | 0.81 | 0.85 | 80 |
| Otitis externa | 0.40 | 0.33 | 6 |
| Tympanosclerosis | 1.00 | 0.25 | 4 |
| **Overall accuracy** | **0.73** | | 139 |

At the app's operating point (threshold 0.6), on the test split about **21 % of diseased ears are still reported as "no signs"** and about **21 % of healthy ears are flagged**.

## Limitations

- **Domain shift.** The model was trained on clinical otoscope images, not on photos from the clip this project is built around. Performance on clip photos is unknown and is likely lower.
- **Small data.** About 950 images in total. Tympanosclerosis and otitis externa have only 28 and 41 images (4 and 6 in the test split), so their metrics are indicative at best.
- **No patient IDs** in the dataset, so near-duplicate images of the same ear may sit in both training and test splits. Reported metrics are probably optimistic.
- **No "not an eardrum" class.** A photo of something else will still get a verdict.
- Fluorescence imaging is not part of the software; there is no public dataset for it.

## How it was built

- **Data:** [Eardrum Dataset (otitis media), Kaggle](https://www.kaggle.com/datasets/erdalbasaran/eardrum-dataset-otitis-media). Six of the nine folders were used (Normal 534, Earwax 140, Acute otitis media 119, Chronic otitis media 63, Otitis externa 41, Tympanosclerosis 28). Three folders with fewer than 20 images (foreign body, pseudomembrane, ear ventilation tube) were dropped. The images are **not** included in this repository.
- **Preprocessing:** the original images are circular endoscope views with black corners. The central 70 % square is cropped (500 px → 350 px) and resized to 224×224. The app applies the same crop. The model takes raw 0–255 RGB; normalisation is inside the network.
- **Split:** 70 / 15 / 15 stratified, `random_state=42`.
- **Model:** MobileNetV3-Small, ImageNet weights. Stage 1: frozen backbone, new head, 10 epochs, lr 1e-3. Stage 2: backbone unfrozen (BatchNorm layers kept frozen), 15 epochs, lr 1e-4. Square-root inverse-frequency class weights, light augmentation (flip, rotation, zoom, brightness, contrast), dropout 0.3.
- **Export:** Keras → SavedModel → ONNX (opset 13), 3.7 MB. Output matches Keras to ~1e-5.
- **App:** plain HTML/JS, onnxruntime-web (WASM, single thread), service worker for offline use.

## Repository layout

```
index.html, app.js          the app
sw.js, manifest.webmanifest offline support and install metadata
ear.onnx                    the trained model
ort/                        onnxruntime-web files (served locally for offline use)
training/                   Colab notebook used for training and export
```

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

A service worker needs HTTPS or `localhost`. If you change any file, bump `CACHE` in `sw.js` (for example `ear-check-v3`), otherwise browsers keep serving the cached copy.

## Retrain

Open `training/train_ear_classifier.ipynb` in Google Colab, upload the dataset zip to Google Drive, and run the cells in order. The last cells export `ear.onnx`. Class order must stay alphabetical: `Aom, Chornic, Earwax, Normal, OtitExterna, tympanoskleros`. This is hard-coded in `app.js`.

## Dataset and license

- Dataset: Eardrum Dataset (otitis media), see the Kaggle link above. **Dataset license: TODO, copy it from the Kaggle page.** Please cite the dataset authors as stated on that page.
- The trained model is derived from this dataset, so the dataset's terms apply to it as well.
- Code in this repository: TODO (for example MIT).

## Acknowledgements

[ONNX Runtime Web](https://github.com/microsoft/onnxruntime) for in-browser inference, [Keras / TensorFlow](https://keras.io) for training, [tf2onnx](https://github.com/onnx/tensorflow-onnx) for export.
