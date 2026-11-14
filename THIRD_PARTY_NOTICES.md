# Third-party notices

This repository includes or derives from the following open-source projects.
The notices below are informational; they do not change the licence of this
repository's own source code.

## sc-datav

- Project: sc-datav
- Upstream: https://github.com/knight-L/sc-datav
- Licence: Apache License 2.0
- Licence copy: [`third_party/sc-datav/LICENSE`](third_party/sc-datav/LICENSE)

The shop command screen at `/admin/shop/analytics/screen` adapts the visual
language of sc-datav — a dark operations display, amber/mint accents and
corner-bracket panels. The implementation is independent: it uses React,
ECharts and native CSS from this repository.

No sc-datav source code is vendored, and none of its bundled assets are copied:
the Three.js 3D map, terrain or turbine models (`.glb`), normal maps, textures,
HDR environment files, fonts, preview images and demo data are not included.
Only the general layout and colour approach is reused under Apache-2.0.

The upstream project's licence file carries the standard Apache-2.0 placeholders
rather than a filled-in copyright line; the attribution above identifies the
upstream project and licence.

## Apache ECharts

- Project: Apache ECharts
- Upstream: https://echarts.apache.org/
- Licence: Apache License 2.0
- Usage: npm dependency `echarts` (charts rendered on the shop command screen).
- Rendering engine: ZRender, BSD-3-Clause, installed automatically as an
  ECharts dependency.

## Other npm dependencies

All other runtime and development dependencies are declared in
[`package.json`](package.json) and [`package-lock.json`](package-lock.json).
Their respective licences apply.
