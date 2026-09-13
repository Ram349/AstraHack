// Speed is metres/second throughout; the dashboard converts once to km/h.
export const RACE_CONFIG = Object.freeze({
  maxSpeed: 72,
  boostSpeed: 86,
  maxEngineForce: 5800,
  reverseEngineForce: 1000,
  reverseMaxSpeed: 7,
  brakingForce: 72,
  steeringResponse: 7,
});
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const approach = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const GEAR_TOP_SPEEDS = [11, 20, 30, 41, 53, 66, 78, 91];

export function createDriveState() {
  return { throttle: 0, brake: 0, steering: 0, boost: 1, boosting: false,
    boostLocked: false, boostCooldown: 0, gear: 1, rpm: 1500,
    shiftTime: 0, acceleration: 0, previousSpeed: 0 };
}

// This controls wheel forces, never the rigid body's position or speed.
export function stepDrivetrain(state, speed, input, dt) {
  const braking = input.handbrake || (input.brake && speed > 0.6)
    || (input.accelerate && speed < -0.6);
  const wantsForward = input.accelerate && !input.brake && !input.handbrake && speed > -0.6;
  const wantsReverse = input.brake && !input.accelerate && !input.handbrake && speed <= 0.6;
  state.throttle = approach(state.throttle, wantsForward ? 1 : wantsReverse ? -1 : 0, 5, dt);
  state.brake = approach(state.brake, braking ? 1 : 0, 14, dt);
  state.steering = approach(state.steering, Number(!!input.left) - Number(!!input.right), 5.2, dt);
  state.shiftTime = Math.max(0, state.shiftTime - dt);
  const absSpeed = Math.abs(speed);
  if (state.gear < 8 && speed > GEAR_TOP_SPEEDS[state.gear - 1] * 0.94) {
    state.gear += 1;
    state.shiftTime = 0.12;
  } else if (state.gear > 1 && speed < GEAR_TOP_SPEEDS[state.gear - 2] * 0.76) {
    state.gear -= 1;
    state.shiftTime = 0.1;
  }
  state.boostCooldown = Math.max(0, state.boostCooldown - dt);
  if (!input.boost && state.boost > 0.2) state.boostLocked = false;
  state.boosting = !!(input.boost && wantsForward && speed > 2 && state.boost > 0 && !state.boostLocked);
  if (state.boosting) {
    state.boost = Math.max(0, state.boost - dt / 4.5);
    state.boostCooldown = 1.3;
    if (state.boost === 0) state.boostLocked = true;
  } else if (state.boostCooldown === 0) {
    state.boost = Math.min(1, state.boost + dt / 12);
  }
  const limit = state.boosting ? RACE_CONFIG.boostSpeed : RACE_CONFIG.maxSpeed;
  const taper = clamp((limit - speed) / 8, 0, 1);
  const torque = 1 - 0.42 * clamp(speed / limit, 0, 1) ** 2;
  const shiftMultiplier = state.shiftTime > 0 ? 0.22 : 1;
  let engine = wantsForward ? Math.max(0, state.throttle) * RACE_CONFIG.maxEngineForce
    * torque * taper * shiftMultiplier * (state.boosting ? 1.5 : 1) : 0;
  if (wantsReverse) engine = Math.min(0, state.throttle) * RACE_CONFIG.reverseEngineForce
    * clamp((RACE_CONFIG.reverseMaxSpeed + speed) / 2, 0, 1);
  // Tight hairpins remain possible; steering progressively softens at speed.
  const steeringLimit = clamp(Math.atan(3.12 * 14 / (absSpeed * absSpeed + 20)), 0.022, 0.44);
  const gentleSteering = Math.sign(state.steering) * Math.abs(state.steering) ** 1.2;
  const sensitivity = clamp(Number.isFinite(input.sensitivity) ? input.sensitivity : 1, 0.75, 1.35);
  const gearFraction = clamp(absSpeed / GEAR_TOP_SPEEDS[state.gear - 1], 0, 1);
  state.rpm = approach(state.rpm, Math.max(1500 + Math.abs(state.throttle) * 1700,
    2500 + gearFraction * 10000), 13, dt);
  state.acceleration = approach(state.acceleration, (speed - state.previousSpeed) / dt, 5, dt);
  state.previousSpeed = speed;
  return {
    engine,
    brake: state.brake * RACE_CONFIG.brakingForce + (!input.accelerate && !input.brake ? 0.35 : 0),
    steering: gentleSteering * steeringLimit * sensitivity,
  };
}

// A quiet procedural motor, intake, wind and tyre layer. Browser interaction
// unlocks audio; Aunty's voice ducks it rather than competing with it.
export class RaceSound {
  async start() {
    if (this.context) return this.context.resume();
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(context.destination);
    this.engineGain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 1200;
    filter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.motors = [1, 2.01, 3.02].map((harmonic) => {
      const oscillator = context.createOscillator();
      oscillator.type = harmonic === 1 ? 'sawtooth' : 'sine';
      oscillator.connect(filter); oscillator.start();
      return { oscillator, harmonic };
    });
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.25;
    const noise = context.createBufferSource(); noise.buffer = noiseBuffer; noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1400; noiseFilter.Q.value = 0.7;
    this.windGain = context.createGain(); this.windGain.gain.value = 0;
    noise.connect(noiseFilter); noiseFilter.connect(this.windGain); this.windGain.connect(this.master);
    this.tyreFilter = context.createBiquadFilter();
    this.tyreFilter.type = 'bandpass'; this.tyreFilter.frequency.value = 1900; this.tyreFilter.Q.value = 3;
    this.tyreGain = context.createGain(); this.tyreGain.gain.value = 0;
    noise.connect(this.tyreFilter); this.tyreFilter.connect(this.tyreGain); this.tyreGain.connect(this.master);
    noise.start();
    await context.resume();
  }
  update(drive, speed, duck, muted) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : duck ? 0.035 : 0.32, now, muted ? 0.025 : 0.12);
    this.engineGain.gain.setTargetAtTime(0.035 + Math.abs(drive.throttle) * 0.06, now, 0.045);
    for (const { oscillator, harmonic } of this.motors)
      oscillator.frequency.setTargetAtTime((35 + drive.rpm / 38) * harmonic, now, 0.045);
    this.windGain.gain.setTargetAtTime(Math.min(0.32, Math.abs(speed) / 270)
      + Math.abs(drive.steering) * Math.abs(speed) / 400, now, 0.12);
    const tyreLoad = Math.max(0, (drive.slip || 0) - 0.7) / 10 + drive.brake * Math.min(1, Math.abs(speed) / 30) * 0.12;
    this.tyreGain.gain.setTargetAtTime(Math.min(0.32, tyreLoad), now, 0.06);
    this.tyreFilter.frequency.setTargetAtTime(1400 + Math.min(1400, tyreLoad * 2200), now, 0.08);
  }
}
