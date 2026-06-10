export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const { text } = req.body
  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: 'Reporte muy corto' })
  }
  try {
    const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 300,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `Sos el sistema de clasificación de reportes del launcher Zotlin. El usuario enviará un bug, una sugerencia o basura. Devolvé ÚNICAMENTE un JSON válido. Si es un bug devolvé {"tipo":"bug","gravedad":"alta|media|baja","resumen":"..."}. Si es una sugerencia devolvé {"tipo":"sugerencia","impacto":"alto|medio|bajo","resumen":"..."}. Si es basura (spam, insultos, publicidad o texto sin sentido) devolvé {"tipo":"basura","gravedad":"baja","resumen":"..."}. La gravedad de un bug debe representar qué tan serio es el problema. El impacto de una sugerencia debe representar cuánto mejoraría Zotlin. El resumen debe tener máximo 15 palabras. No agregues texto antes ni después. No uses markdown. No uses bloques de código. Respondé únicamente con JSON. Texto del usuario: ${text}`
        }]
      })
    })

    const aiData = await aiRes.json()
    const raw = aiData.choices?.[0]?.message?.content || '{}'
    console.log('RAW AI response:', raw)

    const clean = raw.replace(/```json|```/g, '').trim()
    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      parsed = null
    }

    if (
  !parsed ||
  !parsed.tipo ||
  !parsed.resumen ||
  (
    parsed.tipo === 'bug' &&
    !parsed.gravedad
  ) ||
  (
    parsed.tipo === 'sugerencia' &&
    !parsed.impacto
  )
) {
  return res.status(500).json({ error: 'La IA no devolvió un JSON válido' })
}
    const labelMap = {
      bug: 'bug',
      sugerencia: 'enhancement',
      basura: 'spam'
    }
    const gravedadMap = {
  alta: '🔴 Alta',
  media: '🟡 Media',
  baja: '🟢 Baja'
}

const impactoMap = {
  alto: '🔴 Alto',
  medio: '🟡 Medio',
  bajo: '🟢 Bajo'
}

    const label = labelMap[parsed.tipo] || 'bug'
    const gravedadLabel = parsed.gravedad
  ? gravedadMap[parsed.gravedad] || parsed.gravedad
  : null

const impactoLabel = parsed.impacto
  ? impactoMap[parsed.impacto] || parsed.impacto
  : null

    const detalle =
  parsed.tipo === 'sugerencia'
    ? `**Impacto:** ${impactoLabel}`
    : `**Gravedad:** ${gravedadLabel}`

const issueRes = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/issues`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json'
  },
  body: JSON.stringify({
    title: `[${parsed.tipo.toUpperCase()}] ${parsed.resumen}`,
    body: `**Tipo:** ${parsed.tipo}\n${detalle}\n\n---\n\n**Reporte original:**\n\n${text}`,
    labels: [
  label,
  ...(parsed.gravedad ? [`gravedad:${parsed.gravedad}`] : []),
  ...(parsed.impacto ? [`impacto:${parsed.impacto}`] : [])
]
  })
})

    const issueData = await issueRes.json()
    console.log('GitHub response:', JSON.stringify(issueData))

    if (!issueRes.ok) {
      return res.status(500).json({ error: issueData.message })
    }

    return res.status(200).json({ ok: true, tipo: parsed.tipo })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
