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
          content: `Sos el backend de clasificación de Zotlin Launcher. El usuario enviará un reporte (bug o sugerencia). Tu único trabajo es analizarlo objetivamente y devolver ÚNICAMENTE un objeto JSON válido. Sigue estas reglas estrictas para asignar los valores: 1. "tipo": Debe ser exclusivamente "bug", "sugerencia" o "basura". "basura" se usa únicamente para spam, insultos, textos vacíos, flooding ("asdasd"), publicidad o mensajes sin información útil. Una sugerencia simple, menor o de poco valor sigue siendo "sugerencia", nunca "basura". 2. Si es "bug", define "gravedad": "alta" si el juego o launcher no abren, se crashean o hay pérdida de datos; "media" para fallos visuales graves que rompen la usabilidad o botones que no reaccionan; "baja" para detalles estéticos mínimos o errores tipográficos. 3. Si es "sugerencia", define "impacto": "alto" para funciones importantes o mejoras que beneficiarían claramente a gran parte de los usuarios; "medio" para mejoras útiles pero secundarias; "bajo" para cambios cosméticos, preferencias personales, ajustes visuales menores o mejoras con poco beneficio práctico (ej: cambiar tamaños de logos por un par de píxeles, mover elementos estéticos de lugar o cambiar colores por gusto personal). Zotlin es un proyecto serio. Clasificá el impacto según el beneficio real para los usuarios, no según si la idea es fácil de implementar o si está bien redactada. No sobrevalores sugerencias menores. 4. "resumen": String de máximo 15 palabras resumiendo técnicamente la esencia del mensaje. Reglas de formato: No uses bloques de código (json). No agregues texto antes ni después. Solo el JSON puro y crudo. Ejemplo de sugerencia de impacto bajo: Texto: "Que el logo tenga 2 pixeles mas de margen" -> {"tipo":"sugerencia","impacto":"bajo","resumen":"Ajustar margen del logo"}. Texto del usuario: ${text}`
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
