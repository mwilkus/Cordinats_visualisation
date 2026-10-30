# Curvilinear Coordinates Lab

Interactive browser app for visualising curvilinear coordinate systems: covariant and contravariant bases, metric tensor, and Christoffel symbols, in 2D and 3D views.

## Running

No build step. Serve the folder with any static server and open it in a browser:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

## Third-party libraries (bundled in `vendor/`)

- [three.js](https://threejs.org/) r147 + OrbitControls — MIT
- [math.js](https://mathjs.org/) 15.2.0 — Apache-2.0 (includes decimal.js — MIT)
- [KaTeX](https://katex.org/) 0.19.0 — MIT

Full license texts are in `vendor/licenses/`; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

The project's own code is released under the [MIT License](LICENSE).
