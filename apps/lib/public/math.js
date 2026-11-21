import { initChrome, mountEditableDemo, run } from './shared.js';

initChrome();

const TEX_SRC = `### Gaussian integral (fenced \`math\`)

\`\`\`math
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
\`\`\`

### Maxwell's equations (\`application/x-tex\`)

<<<MAXWELL type="application/x-tex" title="Two of Maxwell's equations"
\\begin{aligned}
\\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\
\\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}
\\end{aligned}
MAXWELL

### Rotation matrix & Euler's identity

<<<MATRIX type="application/x-tex" title="2D rotation"
R(\\theta) = \\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}, \\qquad e^{i\\pi} + 1 = 0
MATRIX
`;

const MML_SRC = `<<<QUADRATIC type="application/mathml+xml" title="The quadratic formula"
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mi>x</mi><mo>=</mo>
  <mfrac>
    <mrow>
      <mo>−</mo><mi>b</mi><mo>±</mo>
      <msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt>
    </mrow>
    <mrow><mn>2</mn><mi>a</mi></mrow>
  </mfrac>
</math>
QUADRATIC
`;

run(async () => {
  await mountEditableDemo({
    editorId: 'tex-src',
    viewId: 'tex-view',
    resetId: 'tex-reset',
    timeId: 'tex-time',
    source: TEX_SRC,
  });

  await mountEditableDemo({
    editorId: 'mml-src',
    viewId: 'mml-view',
    resetId: 'mml-reset',
    timeId: 'mml-time',
    source: MML_SRC,
  });
});
