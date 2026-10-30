/* Built-in coordinate systems.
   map:     Cartesian position as math.js expressions of the coordinates (and parameters).
   metric:  optional hand-checked diagonal metric (h_i^2) used for the algebraic view of
            orthogonal systems; verified numerically against the computed metric at load.
   min/max: numbers or expressions in the parameters. */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});
  const PI = Math.PI;

  CV.BUILTIN_SYSTEMS = [
    /* ---------------------------------------------------------------- book: 3D */
    {
      id: 'cartesian', group: '3d', name: 'Cartesian', dim: 3,
      coords: [
        { n: 'x', min: '-inf', max: 'inf', def: 1, surf: 'Planes' },
        { n: 'y', min: '-inf', max: 'inf', def: 0.8, surf: 'Planes' },
        { n: 'z', min: '-inf', max: 'inf', def: 0.6, surf: 'Planes' }],
      map: ['x', 'y', 'z'], metric: ['1', '1', '1'], view: 3.2
    },
    {
      id: 'cylindrical', group: '3d', name: 'Cylindrical', dim: 3,
      coords: [
        { n: 'r', min: 0, max: 'inf', def: 1.6, surf: 'Cylinders  x²+y²=r²' },
        { n: 'theta', min: 0, max: 2 * PI, periodic: true, def: 0.8, surf: 'Half-planes  y/x = tan θ' },
        { n: 'z', min: '-inf', max: 'inf', def: 0.6, surf: 'Planes  z = const' }],
      map: ['r*cos(theta)', 'r*sin(theta)', 'z'], metric: ['1', 'r^2', '1'], view: 3.2
    },
    {
      id: 'spherical', group: '3d', name: 'Spherical', dim: 3,
      coords: [
        { n: 'rho', min: 0, max: 'inf', def: 1.8, surf: 'Spheres  x²+y²+z²=ρ²' },
        { n: 'theta', min: 0, max: PI, def: 0.9, surf: 'Cones  x²+y² = tan²θ z²' },
        { n: 'phi', min: 0, max: 2 * PI, periodic: true, def: 0.7, surf: 'Half-planes  y = x tan φ' }],
      map: ['rho*sin(theta)*cos(phi)', 'rho*sin(theta)*sin(phi)', 'rho*cos(theta)'],
      metric: ['1', 'rho^2', 'rho^2*sin(theta)^2'], view: 3.2
    },
    {
      id: 'parabolic-cyl', group: '3d', name: 'Parabolic cylindrical', dim: 3,
      coords: [
        { n: 'xi', min: '-inf', max: 'inf', def: 1.1, surf: 'Parabolic cylinders' },
        { n: 'eta', min: 0, max: 'inf', def: 0.9, surf: 'Parabolic cylinders' },
        { n: 'z', min: '-inf', max: 'inf', def: 0.5, surf: 'Planes' }],
      map: ['xi*eta', '(xi^2-eta^2)/2', 'z'],
      metric: ['xi^2+eta^2', 'xi^2+eta^2', '1'], view: 3
    },
    {
      id: 'parabolic', group: '3d', name: 'Parabolic', dim: 3,
      coords: [
        { n: 'xi', min: 0, max: 'inf', def: 1.2, surf: 'Paraboloids' },
        { n: 'eta', min: 0, max: 'inf', def: 1.0, surf: 'Paraboloids' },
        { n: 'phi', min: 0, max: 2 * PI, periodic: true, def: 0.8, surf: 'Half-planes' }],
      map: ['xi*eta*cos(phi)', 'xi*eta*sin(phi)', '(xi^2-eta^2)/2'],
      metric: ['xi^2+eta^2', 'xi^2+eta^2', 'xi^2*eta^2'], view: 3
    },
    {
      id: 'elliptic-cyl', group: '3d', name: 'Elliptic cylindrical', dim: 3,
      coords: [
        { n: 'xi', min: 0, max: 'inf', def: 0.8, surf: 'Elliptic cylinders' },
        { n: 'eta', min: 0, max: 2 * PI, periodic: true, def: 1.0, surf: 'Hyperbolic cylinders' },
        { n: 'z', min: '-inf', max: 'inf', def: 0.5, surf: 'Planes' }],
      map: ['cosh(xi)*cos(eta)', 'sinh(xi)*sin(eta)', 'z'],
      metric: ['sinh(xi)^2+sin(eta)^2', 'sinh(xi)^2+sin(eta)^2', '1'], view: 3.2
    },
    {
      id: 'elliptic', group: '3d', name: 'Elliptic', dim: 3,
      coords: [
        { n: 'xi', min: 1, max: 'inf', def: 1.6, surf: 'Prolate ellipsoids' },
        { n: 'eta', min: -1, max: 1, def: 0.45, surf: 'Two-sheeted hyperboloids' },
        { n: 'phi', min: 0, max: 2 * PI, periodic: true, def: 0.8, surf: 'Half-planes' }],
      map: ['sqrt((1-eta^2)*(xi^2-1))*cos(phi)', 'sqrt((1-eta^2)*(xi^2-1))*sin(phi)', 'xi*eta'],
      metric: ['(xi^2-eta^2)/(xi^2-1)', '(xi^2-eta^2)/(1-eta^2)', '(1-eta^2)*(xi^2-1)'], view: 3.2
    },
    {
      id: 'bipolar', group: '3d', name: 'Bipolar', dim: 3,
      params: [{ n: 'a', value: 1, min: 0.3, max: 2.5, hmin: 0 }],
      coords: [
        { n: 'u', min: -PI, max: PI, periodic: true, def: 1.2, surf: 'Cylinders (through foci)' },
        { n: 'v', min: '-inf', max: 'inf', def: 0.6, surf: 'Cylinders (around foci)' },
        { n: 'z', min: '-inf', max: 'inf', def: 0.4, surf: 'Planes' }],
      map: ['a*sinh(v)/(cosh(v)-cos(u))', 'a*sin(u)/(cosh(v)-cos(u))', 'z'],
      metric: ['a^2/(cosh(v)-cos(u))^2', 'a^2/(cosh(v)-cos(u))^2', '1'], view: 3.5
    },
    {
      id: 'conical', name: 'Conical', dim: 3, group: '3d',
      note: 'Angular form of conical (sphero-conal) coordinates: v² = a² + (b²−a²) sin²χ, w = a sin ψ give the classical (u, v, w) with b² > v² > a² > w². Unlike the square-root form it covers all of space. Requires b > a > 0.',
      params: [{ n: 'a', value: 1, min: 0.4, max: 1.6, hmin: 0 }, { n: 'b', value: 2, min: 1.7, max: 3, hmin: 0 }],
      constraints: ['b > a'],
      coords: [
        { n: 'u', min: 0, max: 'inf', def: 1.8, surf: 'Spheres' },
        { n: 'chi', min: 0, max: PI, def: 1.1, surf: 'Elliptic cones (around the z-axis)' },
        { n: 'psi', min: -PI, max: PI, periodic: true, def: 0.5, surf: 'Elliptic cones (around the y-axis)' }],
      map: ['u*sin(psi)*sqrt(a^2+(b^2-a^2)*sin(chi)^2)/b', 'u*sin(chi)*cos(psi)', 'u*cos(chi)*sqrt(b^2-a^2*sin(psi)^2)/b'],
      metric: ['1', 'u^2*(a^2*cos(psi)^2+(b^2-a^2)*sin(chi)^2)/(a^2+(b^2-a^2)*sin(chi)^2)',
        'u^2*(a^2*cos(psi)^2+(b^2-a^2)*sin(chi)^2)/(b^2-a^2*sin(psi)^2)'], view: 3.2
    },
    {
      id: 'prolate', group: '3d', name: 'Prolate spheroidal', dim: 3,
      params: [{ n: 'a', value: 1, min: 0.3, max: 2, hmin: 0 }],
      coords: [
        { n: 'u', min: 0, max: 'inf', def: 0.9, surf: 'Prolate ellipsoids' },
        { n: 'v', min: 0, max: PI, def: 1.0, surf: 'Two-sheeted hyperboloids' },
        { n: 'phi', min: 0, max: 2 * PI, periodic: true, def: 0.8, surf: 'Half-planes' }],
      map: ['a*sinh(u)*sin(v)*cos(phi)', 'a*sinh(u)*sin(v)*sin(phi)', 'a*cosh(u)*cos(v)'],
      metric: ['a^2*(sinh(u)^2+sin(v)^2)', 'a^2*(sinh(u)^2+sin(v)^2)', 'a^2*sinh(u)^2*sin(v)^2'], view: 3.2
    },
    {
      id: 'oblate', group: '3d', name: 'Oblate spheroidal', dim: 3,
      params: [{ n: 'a', value: 1, min: 0.3, max: 2, hmin: 0 }],
      coords: [
        { n: 'xi', min: 0, max: 'inf', def: 0.8, surf: 'Oblate ellipsoids' },
        { n: 'eta', min: -PI / 2, max: PI / 2, def: 0.5, surf: 'One-sheet hyperboloids' },
        { n: 'phi', min: 0, max: 2 * PI, periodic: true, def: 0.8, surf: 'Half-planes' }],
      map: ['a*cosh(xi)*cos(eta)*cos(phi)', 'a*cosh(xi)*cos(eta)*sin(phi)', 'a*sinh(xi)*sin(eta)'],
      metric: ['a^2*(sinh(xi)^2+sin(eta)^2)', 'a^2*(sinh(xi)^2+sin(eta)^2)', 'a^2*cosh(xi)^2*cos(eta)^2'], view: 3.2
    },
    {
      id: 'toroidal', group: '3d', name: 'Toroidal', dim: 3,
      params: [{ n: 'a', value: 1, min: 0.3, max: 2, hmin: 0 }],
      coords: [
        { n: 'u', min: -PI, max: PI, periodic: true, def: 1.1, surf: 'Spheres' },
        { n: 'v', min: 0, max: 'inf', def: 0.9, surf: 'Tori' },
        { n: 'phi', min: 0, max: 2 * PI, periodic: true, def: 0.8, surf: 'Half-planes' }],
      map: ['a*sinh(v)*cos(phi)/(cosh(v)-cos(u))', 'a*sinh(v)*sin(phi)/(cosh(v)-cos(u))', 'a*sin(u)/(cosh(v)-cos(u))'],
      metric: ['a^2/(cosh(v)-cos(u))^2', 'a^2/(cosh(v)-cos(u))^2', 'a^2*sinh(v)^2/(cosh(v)-cos(u))^2'], view: 3.5
    },

    /* --------------------------------------------------------------- extra: 2D */
    {
      id: 'cart2', group: '2d', name: 'Cartesian 2D', dim: 2,
      coords: [{ n: 'x', min: '-inf', max: 'inf', def: 1.2, surf: 'Vertical lines' }, { n: 'y', min: '-inf', max: 'inf', def: 0.8, surf: 'Horizontal lines' }],
      map: ['x', 'y'], metric: ['1', '1'], view: 3.5
    },
    {
      id: 'polar', group: '2d', name: 'Polar', dim: 2,
      coords: [{ n: 'r', min: 0, max: 'inf', def: 1.8, surf: 'Circles' }, { n: 'theta', min: 0, max: 2 * PI, periodic: true, def: 0.7, surf: 'Rays' }],
      map: ['r*cos(theta)', 'r*sin(theta)'], metric: ['1', 'r^2'], view: 3.5
    },
    {
      id: 'elliptic2', group: '2d', name: 'Elliptic', dim: 2,
      params: [{ n: 'a', value: 1, min: 0.3, max: 2.5, hmin: 0 }],
      coords: [{ n: 'mu', min: 0, max: 'inf', def: 0.8, surf: 'Confocal ellipses' }, { n: 'nu', min: 0, max: 2 * PI, periodic: true, def: 1.0, surf: 'Confocal hyperbolas' }],
      map: ['a*cosh(mu)*cos(nu)', 'a*sinh(mu)*sin(nu)'],
      metric: ['a^2*(sinh(mu)^2+sin(nu)^2)', 'a^2*(sinh(mu)^2+sin(nu)^2)'], view: 3.5
    },
    {
      id: 'parabolic2', group: '2d', name: 'Parabolic', dim: 2,
      coords: [{ n: 'xi', min: '-inf', max: 'inf', def: 1.1, surf: 'Parabolas (opening down)' }, { n: 'eta', min: 0, max: 'inf', def: 0.9, surf: 'Parabolas (opening up)' }],
      map: ['xi*eta', '(xi^2-eta^2)/2'], metric: ['xi^2+eta^2', 'xi^2+eta^2'], view: 3.5
    },
    {
      id: 'bipolar2', group: '2d', name: 'Bipolar', dim: 2,
      params: [{ n: 'a', value: 1, min: 0.3, max: 2.5, hmin: 0 }],
      coords: [{ n: 'u', min: -PI, max: PI, periodic: true, def: 1.2, surf: 'Circles through foci' }, { n: 'v', min: '-inf', max: 'inf', def: 0.6, surf: 'Apollonian circles' }],
      map: ['a*sinh(v)/(cosh(v)-cos(u))', 'a*sin(u)/(cosh(v)-cos(u))'],
      metric: ['a^2/(cosh(v)-cos(u))^2', 'a^2/(cosh(v)-cos(u))^2'], view: 3.5
    },
    {
      id: 'hyperbolic2', group: '2d', name: 'Hyperbolic', dim: 2, nonorth: true,
      note: 'ν = ±√(xy), μ = −½ ln(y/x). Covers the quadrants where xy > 0 (ν < 0 gives the third quadrant). Points with xy < 0 lie on no hyperbola xy = ν², so no choice of (μ, ν) reaches them. Rays and hyperbolas are not perpendicular – a non-orthogonal system.',
      coords: [{ n: 'mu', min: '-inf', max: 'inf', def: 0.3, surf: 'Rays y = x·e^{−2μ}' }, { n: 'nu', min: '-inf', max: 'inf', def: 1.2, surf: 'Hyperbolas xy = ν²' }],
      map: ['nu*exp(mu)', 'nu*exp(-mu)'], view: 3.5
    },
    {
      id: 'logpolar', group: '2d', name: 'Log-polar', dim: 2,
      coords: [{ n: 'rho', min: '-inf', max: 'inf', def: 0.4, surf: 'Circles r = e^ρ' }, { n: 'theta', min: 0, max: 2 * PI, periodic: true, def: 0.7, surf: 'Rays' }],
      map: ['exp(rho)*cos(theta)', 'exp(rho)*sin(theta)'], metric: ['exp(2*rho)', 'exp(2*rho)'], view: 3.5
    },
    {
      id: 'oblique2', group: '2d', name: 'Oblique (affine)', dim: 2, nonorth: true,
      note: 'Straight but skewed axes – the simplest non-orthogonal system. Covariant and contravariant bases differ.',
      params: [{ n: 'alpha', value: 1.0, min: 0.25, max: 2.9, hmin: 0, hmax: PI }],
      coords: [{ n: 'u', min: '-inf', max: 'inf', def: 1.0, surf: 'Lines parallel to E₂' }, { n: 'v', min: '-inf', max: 'inf', def: 1.0, surf: 'Lines parallel to E₁' }],
      map: ['u+v*cos(alpha)', 'v*sin(alpha)'], view: 3.5
    },
    {
      id: 'ellpolar2', group: '2d', name: 'Elliptical polar', dim: 2, nonorth: true,
      note: 'Polar coordinates stretched into ellipses – non-orthogonal whenever a ≠ b.',
      params: [{ n: 'a', value: 2, min: 0.4, max: 3, hmin: 0 }, { n: 'b', value: 1, min: 0.4, max: 3, hmin: 0 }],
      coords: [{ n: 'r', min: 0, max: 'inf', def: 1.2, surf: 'Similar ellipses' }, { n: 'theta', min: 0, max: 2 * PI, periodic: true, def: 0.7, surf: 'Rays' }],
      map: ['a*r*cos(theta)', 'b*r*sin(theta)'], view: 3.5
    },
    {
      id: 'sheared2', group: '2d', name: 'Sheared parabolic', dim: 2, nonorth: true,
      note: 'Curvilinear and non-orthogonal: the u-lines are straight, the v-lines are parabolas.',
      params: [{ n: 'k', value: 0.4, min: -1, max: 1 }],
      coords: [{ n: 'u', min: '-inf', max: 'inf', def: 0.6, surf: 'Parabolas x = u + k y²' }, { n: 'v', min: '-inf', max: 'inf', def: 1.0, surf: 'Horizontal lines' }],
      map: ['u+k*v^2', 'v'], view: 3.5
    },
    {
      id: 'skewpolar2', group: '2d', name: 'Spiral (log-spiral)', dim: 2, nonorth: true,
      note: 'r = e^{s + c·θ}: the s-curves are rays, the θ-curves are logarithmic spirals.',
      params: [{ n: 'c', value: 0.25, min: -0.6, max: 0.6 }],
      coords: [{ n: 's', min: '-inf', max: 'inf', def: 0.2, surf: 'Log-spirals' }, { n: 'theta', min: '-inf', max: 'inf', def: 0.9, surf: 'Rays' }],
      map: ['exp(s+c*theta)*cos(theta)', 'exp(s+c*theta)*sin(theta)'], view: 3.5
    },

    /* --------------------------------------------------------------- extra: 3D */
    {
      id: 'helical', group: '3d', name: 'Helical (twisted cylindrical)', dim: 3, nonorth: true,
      note: 'Cylindrical coordinates whose angle twists with height – θ-surfaces are helicoids. Non-orthogonal for k ≠ 0.',
      params: [{ n: 'k', value: 0.6, min: -1.5, max: 1.5 }],
      coords: [
        { n: 'r', min: 0, max: 'inf', def: 1.5, surf: 'Cylinders' },
        { n: 'theta', min: 0, max: 2 * PI, periodic: true, def: 0.6, surf: 'Helicoids' },
        { n: 'z', min: '-inf', max: 'inf', def: 0.5, surf: 'Planes' }],
      map: ['r*cos(theta+k*z)', 'r*sin(theta+k*z)', 'z'], view: 3
    },
    {
      id: 'oblique3', group: '3d', name: 'Oblique (affine) 3D', dim: 3, nonorth: true,
      note: 'Straight skewed axes E₁ = (1,0,0), E₂ = (cos α, sin α, 0), E₃ = (cos β, 0, sin β).',
      params: [{ n: 'alpha', value: 1.1, min: 0.3, max: 2.8, hmin: 0, hmax: PI }, { n: 'beta', value: 1.2, min: 0.3, max: 2.8, hmin: 0, hmax: PI }],
      coords: [
        { n: 'u', min: '-inf', max: 'inf', def: 0.7, surf: 'Planes' },
        { n: 'v', min: '-inf', max: 'inf', def: 0.6, surf: 'Planes' },
        { n: 'w', min: '-inf', max: 'inf', def: 0.6, surf: 'Planes' }],
      map: ['u+v*cos(alpha)+w*cos(beta)', 'v*sin(alpha)', 'w*sin(beta)'], view: 3.2
    },
    {
      id: 'bispherical', group: '3d', name: 'Bispherical', dim: 3,
      params: [{ n: 'a', value: 1, min: 0.3, max: 2, hmin: 0 }],
      coords: [
        { n: 'sigma', min: 0, max: PI, def: 1.1, surf: 'Spindle tori / apple surfaces' },
        { n: 'v', min: '-inf', max: 'inf', def: 0.7, surf: 'Spheres (around foci)' },
        { n: 'phi', min: 0, max: 2 * PI, periodic: true, def: 0.8, surf: 'Half-planes' }],
      map: ['a*sin(sigma)*cos(phi)/(cosh(v)-cos(sigma))', 'a*sin(sigma)*sin(phi)/(cosh(v)-cos(sigma))', 'a*sinh(v)/(cosh(v)-cos(sigma))'],
      metric: ['a^2/(cosh(v)-cos(sigma))^2', 'a^2/(cosh(v)-cos(sigma))^2', 'a^2*sin(sigma)^2/(cosh(v)-cos(sigma))^2'], view: 3.5
    }
  ];

  CV.GROUPS = [
    { id: '3d', label: '3D' },
    { id: '2d', label: '2D' },
    { id: 'custom', label: 'Custom' }
  ];
})();
