export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text } = req.body || {}
  const reportText = typeof text === 'string' ? text.trim() : ''

  if (!reportText || reportText.length < 10) {
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
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        max_completion_tokens: 300,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'loryq_report_classification',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                tipo: {
                  type: 'string',
                  enum: ['bug', 'sugerencia', 'basura']
                },
                gravedad: {
                  type: 'string',
                  enum: ['alta', 'media', 'baja', 'none']
                },
                impacto: {
                  type: 'string',
                  enum: ['alto', 'medio', 'bajo', 'none']
                },
                resumen: {
                  type: 'string'
                }
              },
              required: ['tipo', 'gravedad', 'impacto', 'resumen'],
              additionalProperties: false
            }
          }
        },
        messages: [
          {
            role: 'system',
            content: `Sos el backend de clasificación de reportes de Loryq Launcher.

Tu único trabajo es analizar objetivamente el reporte del usuario y devolver un JSON válido que cumpla el schema.

Reglas:
1. "tipo" debe ser exclusivamente "bug", "sugerencia" o "basura".
2. "basura" se usa únicamente para spam, insultos, textos vacíos, flooding, publicidad o mensajes sin información útil.
3. Una sugerencia simple, menor o de poco valor sigue siendo "sugerencia", nunca "basura".
4. Si es "bug":
   - "gravedad": "alta" si el juego o launcher no abren, se crashean o hay pérdida de datos.
   - "gravedad": "media" para fallos visuales graves que rompen la usabilidad o botones que no reaccionan.
   - "gravedad": "baja" para detalles estéticos mínimos o errores tipográficos.
   - "impacto": "none".
5. Si es "sugerencia":
   - "impacto": "alto" para funciones importantes o mejoras que beneficiarían a gran parte de los usuarios.
   - "impacto": "medio" para mejoras útiles pero secundarias.
   - "impacto": "bajo" para cambios cosméticos, preferencias personales o ajustes visuales menores.
   - "gravedad": "none".
6. Si es "basura":
   - "gravedad": "none".
   - "impacto": "none".
7. "resumen" debe tener máximo 15 palabras y resumir técnicamente la esencia del mensaje.
8. No sobrevalores sugerencias menores. Clasificá según beneficio real para usuarios, no por facilidad de implementación.`
          },
          {
            role: 'user',
            content: `Texto del usuario:\n${reportText}`
          }
        ]
      })
    })

    const aiData = await aiRes.json().catch(() => null)

    if (!aiRes.ok) {
      console.error('Groq error:', JSON.stringify(aiData))
      return res.status(500).json({
        error: aiData?.error?.message || 'Error de Groq'
      })
    }

    const raw = aiData?.choices?.[0]?.message?.content

    if (!raw) {
      console.error('Groq response without content:', JSON.stringify(aiData))
      return res.status(500).json({
        error: 'Groq no devolvió contenido'
      })
    }

    console.log('RAW AI response:', raw)

    const clean = raw.replace(/```json|```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch (err) {
      console.error('Invalid JSON from AI:', clean)
      return res.status(500).json({
        error: 'La IA no devolvió un JSON válido'
      })
    }

    if (parsed.gravedad === 'none') parsed.gravedad = null
    if (parsed.impacto === 'none') parsed.impacto = null

    const validTipos = ['bug', 'sugerencia', 'basura']
    const validGravedades = ['alta', 'media', 'baja']
    const validImpactos = ['alto', 'medio', 'bajo']

    const invalidBase =
      !parsed ||
      !validTipos.includes(parsed.tipo) ||
      !parsed.resumen ||
      typeof parsed.resumen !== 'string'

    const invalidBug =
      parsed?.tipo === 'bug' &&
      !validGravedades.includes(parsed.gravedad)

    const invalidSuggestion =
      parsed?.tipo === 'sugerencia' &&
      !validImpactos.includes(parsed.impacto)

    const invalidTrash =
      parsed?.tipo === 'basura' &&
      (parsed.gravedad || parsed.impacto)

    if (invalidBase || invalidBug || invalidSuggestion || invalidTrash) {
      console.error('Invalid classification object:', JSON.stringify(parsed))
      return res.status(500).json({
        error: 'La IA devolvió una clasificación incompleta o inválida'
      })
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

    const metadata = [`**Tipo:** ${parsed.tipo}`]

    if (parsed.gravedad) {
      metadata.push(`**Gravedad:** ${gravedadMap[parsed.gravedad] || parsed.gravedad}`)
    }

    if (parsed.impacto) {
      metadata.push(`**Impacto:** ${impactoMap[parsed.impacto] || parsed.impacto}`)
    }

    const issueRes = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({
        title: `[${parsed.tipo.toUpperCase()}] ${parsed.resumen}`,
        body: `${metadata.join('\n')}\n\n---\n\n**Reporte original:**\n\n${reportText}`,
        labels: [
          label,
          ...(parsed.gravedad ? [`gravedad:${parsed.gravedad}`] : []),
          ...(parsed.impacto ? [`impacto:${parsed.impacto}`] : [])
        ]
      })
    })

    const issueData = await issueRes.json().catch(() => null)
    console.log('GitHub response:', JSON.stringify(issueData))

    if (!issueRes.ok) {
      return res.status(500).json({
        error: issueData?.message || 'Error creando el issue en GitHub'
      })
    }

    return res.status(200).json({
      ok: true,
      tipo: parsed.tipo,
      gravedad: parsed.gravedad,
      impacto: parsed.impacto,
      resumen: parsed.resumen,
      issue_url: issueData?.html_url || null
    })
  } catch (err) {
    console.error('Report handler error:', err)
    return res.status(500).json({
      error: err.message || 'Error interno'
    })
  }
}
