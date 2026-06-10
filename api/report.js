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
          content: `Sos un filtro de bugs para el launcher Zotlin. El usuario te manda un texto describiendo un problema o sugerencia. Devolvé ÚNICAMENTE un JSON válido con exactamente estas tres claves: "tipo": solo puede ser "bug", "sugerencia" o "basura" (basura = spam, insultos, texto sin sentido), "gravedad": solo puede ser "alta", "media" o "baja", "resumen": string de máximo 15 palabras describiendo el problema. No agregues texto antes ni después. No uses markdown. No uses bloques de código. Solo el JSON puro. Ejemplo de respuesta válida: {"tipo":"bug","gravedad":"alta","resumen":"El launcher se cierra al iniciar Minecraft 1.21"}\n\nTexto del usuario: ${text}`
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

    if (!parsed || !parsed.tipo || !parsed.resumen) {
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

    const label = labelMap[parsed.tipo] || 'bug'
    const gravedadLabel = gravedadMap[parsed.gravedad] || parsed.gravedad

const issueRes = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/issues`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json'
  },
  body: JSON.stringify({
    title: `[${parsed.tipo.toUpperCase()}] ${parsed.resumen}`,
    body: `**Tipo:** ${parsed.tipo}\n**Gravedad:** ${gravedadLabel}\n\n---\n\n**Reporte original:**\n\n${text}`,
    labels: [label]
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
