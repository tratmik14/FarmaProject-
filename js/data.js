// Генератор синтетической телеметрии CIP-цикла и сравнение с "золотым профилем".
// ЭТО ДЕМО-СИМУЛЯЦИЯ для наглядности интерфейса, а не обученная модель из прототипа.
// Полная модель (GradientBoostingRegressor + RandomForestClassifier) находится в
// Python-прототипе; здесь воспроизведена только логика сравнения с профилем.

const CYCLE_MINUTES = 45;      // плановая длительность цикла, мин
const WARN_WINDOW = 12;        // окно раннего предупреждения, мин (как в презентации)
const TICK_MS = 650;           // 1 "минута" цикла = TICK_MS реального времени (демо-скорость)

const CHANNELS = [
  { key: "current", label: "Ток насоса", unit: "А", nominalEnd: 12.5, rampTau: 4 },
  { key: "pressure", label: "Давление", unit: "бар", nominalEnd: 3.1, rampTau: 3 },
  { key: "flow", label: "Расход", unit: "м³/ч", nominalEnd: 30.4, rampTau: 3.5 },
  { key: "conductivity", label: "Проводимость ополаскивания", unit: "мкСм/см", nominalEnd: 120, rampTau: 6, decays: true },
  { key: "temperature", label: "Температура", unit: "°C", nominalEnd: 58, rampTau: 5 },
];

// Golden profile value at time t (minutes), a smooth ramp/decay to the nominal steady value.
function goldenValue(ch, t) {
  const k = 1 - Math.exp(-t / ch.rampTau);
  if (ch.decays) {
    // conductivity starts high (previous product) and decays toward baseline
    const start = ch.nominalEnd * 7;
    return start * Math.exp(-t / ch.rampTau) + ch.nominalEnd * 0.08;
  }
  return ch.nominalEnd * k + ch.nominalEnd * 0.04 * Math.sin(t / 6);
}

// Band half-width (±) considered "in spec" at time t — narrower early, as in GMP uставки.
function goldenSigma(ch, t) {
  const base = ch.nominalEnd * 0.06;
  return Math.max(base, ch.nominalEnd * 0.1 * Math.exp(-t / 10));
}

const SCENARIOS = {
  normal: {
    label: "Норма",
    describe: "Цикл идёт в пределах золотого профиля.",
    drift: () => 0,
  },
  pump_wear: {
    label: "Износ насоса",
    describe: "Постепенное снижение расхода и рост тока насоса.",
    drift: (t) => ({ current: 1 + 0.05 * t, flow: -0.9 - 0.06 * t }),
  },
  nozzle_clog: {
    label: "Засор форсунки",
    describe: "Резкое падение расхода после 6–8 минут цикла.",
    drift: (t) => (t > 6 ? { flow: -2.2 - 0.12 * (t - 6), pressure: 0.15 * (t - 6) } : {}),
  },
  residual: {
    label: "Остаток продукта",
    describe: "Проводимость ополаскивания не выходит на базовый уровень.",
    drift: (t) => ({ conductivity: 35 + 4 * t }),
  },
};

function noise(scale) {
  return (Math.random() - 0.5) * 2 * scale;
}

/**
 * Create a simulation session for one CIP cycle under a given scenario.
 */
function createCycleSimulator(scenarioKey) {
  const scenario = SCENARIOS[scenarioKey] || SCENARIOS.normal;
  let t = 0;
  return {
    scenario,
    scenarioKey,
    done: false,
    tick() {
      t += 1;
      const drift = scenario.drift(t) || {};
      const readings = {};
      for (const ch of CHANNELS) {
        const g = goldenValue(ch, t);
        const sigma = goldenSigma(ch, t);
        const d = drift[ch.key] || 0;
        const val = g + d + noise(sigma * 0.35);
        readings[ch.key] = { value: val, golden: g, sigma, z: (val - g) / sigma };
      }
      this.done = t >= CYCLE_MINUTES;
      return { t, readings, done: this.done };
    },
  };
}

/**
 * Turn a tick's readings into a deviation score and, once past a minimal
 * observation window, a demo "predicted extra delay" with a 10-90% band.
 * This is a simple heuristic stand-in for the trained model, tuned only
 * so the UI behaves sensibly — not a fitted statistical model.
 */
function assessTick(t, readings) {
  const zFlow = readings.flow.z;
  const zCurrent = readings.current.z;
  const zCond = readings.conductivity.z;
  const worst = Math.max(Math.abs(zFlow), Math.abs(zCurrent) * 0.8, Math.abs(zCond) * 0.5);

  const inSpec = Math.abs(zFlow) <= 2 && Math.abs(zCurrent) <= 2.2;
  let predictedDelay = null;
  if (t >= 4) {
    const base = Math.max(0, (worst - 1.1)) * 3.1;
    predictedDelay = {
      mid: Math.round(base * 10) / 10,
      low: Math.round(Math.max(0, base - 2.4) * 10) / 10,
      high: Math.round((base + 2.8) * 10) / 10,
    };
  }

  let likelyCause = null;
  if (worst > 1.3) {
    const causes = [
      { name: "засорение форсунок", score: Math.abs(zFlow) * 1.3 },
      { name: "износ насоса", score: Math.abs(zCurrent) * 1.1 },
      { name: "остаток продукта", score: Math.abs(zCond) * 0.9 },
    ].sort((a, b) => b.score - a.score);
    const total = causes.reduce((s, c) => s + c.score, 0) || 1;
    likelyCause = causes.map((c) => ({ name: c.name, pct: Math.round((c.score / total) * 100) }));
  }

  return { worst, inSpec, predictedDelay, likelyCause, withinWarnWindow: t <= WARN_WINDOW };
}
