# Browser analysis assets

- COCO-SSD Lite MobileNet V2 comes from the [official TensorFlow.js model distribution](https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json). The model and its five weight shards are bundled together. See the Apache 2.0 license in `coco-ssd-lite/LICENSE`.
- English OCR data comes from [Tesseract.js Data English 1.0.0](https://www.npmjs.com/package/@tesseract.js-data/eng/v/1.0.0), using the `4.0.0_best_int` data set. Vite emits the worker and WebAssembly loader from the installed Tesseract.js dependencies. See the Apache 2.0 license in `plate-ocr/LICENSE`.
