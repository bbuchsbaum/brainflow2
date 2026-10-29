These notices accompany the unmodified public template assets served by the
browser build. Each notice is copied from the corresponding TemplateFlow
repository; `index.json` records that URL. `tools/prepare-browser-catalog.mjs`
verifies each image against the SHA-256 in `../catalog.json` and includes its
notice and provenance in the static output.

The existing MNI152NLin6Asym entries remain in the shared catalog, but their
TemplateFlow repository does not contain the LICENSE file referenced by its
metadata. They are not mirrored here. Users may download the original through
its source link and open it locally. MNI305 T2w's existing upstream URL returned
404 during verification; it is also excluded from the static assets.

Mirrors use `.nii.gz.bin` so static hosts do not mistake file compression for
HTTP Content-Encoding and change the bytes delivered to the browser. The app
retains the original `.nii.gz` filename and verifies the compressed-byte digest.
Catalog images are not service-worker precache entries. Selected private files
are never included in this preparation step or in the static build.
