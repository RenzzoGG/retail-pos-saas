# Vendored dependencies

## `xlsx-0.20.3.tgz` — SheetJS Community Edition 0.20.3 (Apache-2.0)

- Source: the official SheetJS CDN, https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- Why vendored: the `xlsx` package on the npm registry stopped at 0.18.5, which has known
  vulnerabilities (prototype pollution, ReDoS). SheetJS publishes current versions only on its CDN, and
  npm 12 refuses remote tarball dependencies by default (`allow-remote`). Keeping the tarball here
  (installed as `file:vendor/...`) is what SheetJS recommends: installs are reproducible, CI/Docker don't
  depend on the CDN, and `package-lock.json` pins its `sha512` integrity.
- The package has no dependencies and no install scripts.
- To upgrade: download the new tarball from the CDN, verify it, replace the file and run
  `npm i ./vendor/xlsx-<version>.tgz`.
