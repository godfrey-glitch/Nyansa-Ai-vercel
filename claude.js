// Nyansa AI — AI Proxy for Vercel
// Groq primary, Gemini fallback

export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method Not Allowed' } });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!groqKey && !geminiKey) {
    return res.status(500).json({ error: { message: 'No API key set. Add GROQ_API_KEY in Vercel environment variables.' } });
  }

  try {
    const body = req.body;

    // ── Try Groq first ──────────────────────────────────────────────────────
    if (groqKey) {
      const messages = [];
      if (body.system) messages.push({ role: 'system', content: body.system });
      (body.messages || []).forEach(m => {
        messages.push({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : (m.content[0]?.text || '')
        });
      });

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          max_tokens: body.max_tokens || 800,
          temperature: 0.7
        })
      });

      const groqData = await groqRes.json();

      if (groqRes.ok) {
        const text = groqData.choices?.[0]?.message?.content || '';
        return res.status(200).json({ content: [{ type: 'text', text }] });
      }

      // If not rate limited or no Gemini fallback, return error
      if (groqRes.status !== 429 || !geminiKey) {
        const friendly = groqRes.status === 429
          ? 'AI limit reached. Please try again in a moment.'
          : (groqData.error?.message || 'Groq API error');
        return res.status(groqRes.status).json({ error: { message: friendly } });
      }
    }

    // ── Gemini fallback ─────────────────────────────────────────────────────
    const contents = (body.messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : (m.content[0]?.text || '') }]
    }));

    const geminiBody = {
      contents,
      generationConfig: { maxOutputTokens: body.max_tokens || 800, temperature: 0.7 }
    };
    if (body.system) geminiBody.systemInstruction = { parts: [{ text: body.system }] };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      const friendly = geminiRes.status === 429
        ? 'Daily AI limit reached. Please try again tomorrow.'
        : (geminiData.error?.message || 'Gemini API error');
      return res.status(geminiRes.status).json({ error: { message: friendly } });
    }

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (err) {
    return res.status(500).json({ error: { message: err.message || 'Server error' } });
  }
}
