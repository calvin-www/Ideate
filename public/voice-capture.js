class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.muted = false;
    this.frame = new Int16Array(320);
    this.frameOffset = 0;
    this.phase = 0;
    this.sumSquares = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "mute") {
        this.muted = Boolean(event.data.value);
        this.frameOffset = 0;
        this.sumSquares = 0;
      } else if (event.data?.type === "close") {
        this.active = false;
      }
    };
  }

  process(inputs) {
    if (!this.active) return false;
    const channel = inputs[0]?.[0];
    if (!channel || this.muted) return true;

    for (let index = 0; index < channel.length; index += 1) {
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.frame[this.frameOffset] =
        sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      this.sumSquares += sample * sample;
      this.frameOffset += 1;
      if (this.frameOffset === this.frame.length) {
        const pcm = this.frame.buffer;
        this.port.postMessage(
          {
            type: "audio",
            pcm,
            rms: Math.sqrt(this.sumSquares / this.frame.length),
            durationMs: 20,
          },
          [pcm],
        );
        this.frame = new Int16Array(320);
        this.frameOffset = 0;
        this.sumSquares = 0;
      }
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
