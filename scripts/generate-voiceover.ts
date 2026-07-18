import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { content } from "../src/content";

// TTS_PROVIDER=elevenlabs (預設) | gemini
// ElevenLabs 必填:ELEVENLABS_API_KEY、ELEVENLABS_VOICE_ID
//   選填:ELEVENLABS_MODEL、ELEVENLABS_SAMPLE_RATE、ELEVENLABS_SPEED
// Gemini 必填:GOOGLE_API_KEY(voice / model 從 content.voiceover 讀)

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// 簡易 .env 讀取（避免引入 dotenv 套件）
// 從 cwd 往上走找最近的 .env，讓所有 worktree 共用 main 的 .env
function findEnvFile(): string | null {
  let dir = projectRoot;
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadEnv() {
  const envPath = findEnvFile();
  if (!envPath) return;
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

if (!content.voiceover.enabled) {
  console.error(
    "❌ content.voiceover.enabled is false — set it to true in src/content.ts first",
  );
  process.exit(1);
}

const PROVIDER = (process.env.TTS_PROVIDER ?? "elevenlabs").toLowerCase();

type SceneToRender = { id: string; text: string };
type AudioResult = { pcm: Buffer; sampleRate: number };

const ALL_SCENES: SceneToRender[] = content.scenes
  .filter((s) => Boolean(s.voiceover))
  .map((s) => ({ id: s.id, text: s.voiceover as string }));

if (ALL_SCENES.length === 0) {
  console.error("❌ No scenes have a `voiceover` field set in src/content.ts");
  process.exit(1);
}

function pcmToWav(
  pcm: Buffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function makeElevenLabsProvider() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const model = process.env.ELEVENLABS_MODEL ?? "eleven_v3";
  // PCM 取樣率:Starter / Creator 上限 24000;Pro 才解鎖 44100。
  const sampleRate = Number(process.env.ELEVENLABS_SAMPLE_RATE ?? 24000);
  // 語速倍率:0.5 ~ 2.0,1.0 = 原速。沒設就跟模型預設走。
  const speedRaw = process.env.ELEVENLABS_SPEED;
  const speed = speedRaw ? Number(speedRaw) : undefined;

  if (!apiKey) {
    console.error("❌ Missing ELEVENLABS_API_KEY in .env");
    process.exit(1);
  }
  if (!voiceId) {
    console.error("❌ Missing ELEVENLABS_VOICE_ID in .env");
    process.exit(1);
  }

  return {
    label: `ElevenLabs ${model} @ ${sampleRate}Hz, voice=${voiceId}${speed !== undefined ? `, speed=${speed}` : ""}`,
    delayMs: 0,
    async generate(scene: SceneToRender): Promise<AudioResult> {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_${sampleRate}`;
      const body: Record<string, unknown> = {
        text: scene.text,
        model_id: model,
      };
      if (speed !== undefined) {
        body.voice_settings = { speed };
      }
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(
          `ElevenLabs TTS failed for ${scene.id}: ${resp.status}\n${errText}`,
        );
      }
      const pcm = Buffer.from(await resp.arrayBuffer());
      if (pcm.length === 0) {
        throw new Error(`ElevenLabs returned empty audio for ${scene.id}`);
      }
      return { pcm, sampleRate };
    },
  };
}

function makeGeminiProvider() {
  const apiKey = process.env.GOOGLE_API_KEY;
  const model = content.voiceover.model ?? "gemini-2.5-flash-preview-tts";
  const voice = content.voiceover.voice ?? "Puck";
  // promptPrefix 是給 Gemini 的語言指示,ElevenLabs 不吃(會被唸出來)
  const promptPrefix = content.voiceover.promptPrefix ?? "";
  const sampleRate = 24000; // Gemini TTS 固定 24kHz

  if (!apiKey) {
    console.error(
      "❌ Missing GOOGLE_API_KEY in .env (get one from Google AI Studio)",
    );
    process.exit(1);
  }

  return {
    label: `Gemini ${model}, voice=${voice}`,
    delayMs: 7000, // Gemini TTS 限速嚴,維持 7 秒間隔
    async generate(scene: SceneToRender): Promise<AudioResult> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ parts: [{ text: promptPrefix + scene.text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      };
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(
          `Gemini TTS failed for ${scene.id}: ${resp.status}\n${errText}`,
        );
      }
      const json = (await resp.json()) as {
        candidates?: {
          content?: { parts?: { inlineData?: { data: string } }[] };
        }[];
      };
      const audioB64 =
        json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioB64) {
        console.error(`❌ Unexpected Gemini response for ${scene.id}:`);
        console.error(JSON.stringify(json, null, 2).slice(0, 800));
        throw new Error("No audio in Gemini response");
      }
      return { pcm: Buffer.from(audioB64, "base64"), sampleRate };
    },
  };
}

const provider =
  PROVIDER === "gemini"
    ? makeGeminiProvider()
    : PROVIDER === "elevenlabs"
      ? makeElevenLabsProvider()
      : (() => {
          console.error(
            `❌ 未知 TTS_PROVIDER="${PROVIDER}"。支援:elevenlabs, gemini`,
          );
          process.exit(1);
        })();

// CLI: npm run voiceover                  → regenerate all
//      npm run voiceover -- scene-03      → only specific scenes
const filter = process.argv.slice(2);
const toGenerate =
  filter.length > 0
    ? ALL_SCENES.filter((s) => filter.includes(s.id))
    : ALL_SCENES;

if (toGenerate.length === 0) {
  console.error(`❌ No matching scenes for: ${filter.join(", ")}`);
  console.error(`   Available: ${ALL_SCENES.map((s) => s.id).join(", ")}`);
  process.exit(1);
}
console.log(
  `🎙️  Generating voiceover [${provider.label}] for: ${toGenerate.map((s) => s.id).join(", ")}`,
);

const durationsPath = join(
  projectRoot,
  "public",
  "voiceover",
  "durations.json",
);
let durations: Record<string, number> = {};
if (existsSync(durationsPath)) {
  durations = JSON.parse(readFileSync(durationsPath, "utf-8"));
}

void (async () => {
  for (const scene of toGenerate) {
    const { pcm, sampleRate } = await provider.generate(scene);
    const wav = pcmToWav(pcm, sampleRate);

    const outDir = join(projectRoot, "public", "voiceover");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${scene.id}.wav`);
    writeFileSync(outPath, wav);
    const seconds = pcm.length / (sampleRate * 2);
    console.log(
      `✓ ${scene.id}: ${(wav.length / 1024).toFixed(1)} KB (${seconds.toFixed(2)}s) → ${outPath}`,
    );
    durations[scene.id] = seconds;

    if (
      provider.delayMs > 0 &&
      toGenerate.indexOf(scene) < toGenerate.length - 1
    ) {
      await new Promise((r) => setTimeout(r, provider.delayMs));
    }
  }

  writeFileSync(durationsPath, JSON.stringify(durations, null, 2));
  console.log(`\n🎙️  Done — ${toGenerate.length} clip(s) written.`);
})();
