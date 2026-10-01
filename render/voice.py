"""Edge TTS helper for render/voice.mjs: one phrase in, an mp3 and the start/end of every word out.
Usage: python voice.py TEXT_FILE VOICE RATE OUT_BASE        writes OUT_BASE.mp3 and OUT_BASE.words.json
Needs `pip install edge-tts` (LGPL-3.0; it is run as a separate tool and is not bundled with the kit).
Note: edge-tts talks to the same service as Microsoft Edge's "Read aloud". It is free and needs no key, but it is not an official
public API: use it for drafts and for projects where that is acceptable; for a commercial release use the openrouter engine."""
import asyncio, json, sys

import edge_tts

text_file, voice, rate, out = sys.argv[1:5]
text = open(text_file, encoding='utf8').read().strip()


async def main():
    com = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
    words = []
    with open(out + '.mp3', 'wb') as f:
        async for ch in com.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] == 'WordBoundary':
                words.append({'word': ch['text'], 'start': round(ch['offset'] / 1e7, 3), 'end': round((ch['offset'] + ch['duration']) / 1e7, 3)})
    if not words:
        sys.exit('edge-tts returned no word boundaries for: ' + text[:60])
    with open(out + '.words.json', 'w', encoding='utf8') as f:
        json.dump(words, f, ensure_ascii=False)


asyncio.run(main())
