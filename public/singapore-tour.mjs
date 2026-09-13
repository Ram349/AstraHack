// Model-space anchors were ray-picked from the actual GLB in the overhead
// inspector (2026-09-13). These are broad proximity areas, not GPS coordinates.
// The supplied environment depicts the historic Float layout, not modern NS Square.
export const TOUR_ZONES = [
  { id: 'pit', name: 'Pit Straight', x: -603, z: 241, radius: 210,
    source: 'https://www.ura.gov.sg/land-planning/shaping-our-city/marina-bay/',
    facts: [
      'Singapore hosted Formula One’s first night race in 2008.',
      'Marina Bay is a street circuit: the race runs through the city.',
    ] },
  { id: 'flyer', name: 'Singapore Flyer', x: -502, z: 40, radius: 165,
    source: 'https://www.visitsingapore.com/neighbourhood/featured-neighbourhood/marina-bay/singapore-flyer/',
    facts: [
      'The Singapore Flyer is a 165-metre observation wheel overlooking Marina Bay.',
      'The Flyer’s glass capsules give panoramic views of the bay and Singapore River.',
    ] },
  { id: 'float', name: 'Marina Bay Waterfront', x: -14, z: 14, radius: 210,
    source: 'https://www.mindef.gov.sg/news-and-events/latest-releases/19mar24_fs/',
    facts: [
      'The old Float at Marina Bay shown in this circuit model hosted National Day Parades.',
      'The Float was built in 2007 as a temporary venue while the National Stadium was being redeveloped.',
    ] },
  { id: 'esplanade', name: 'Esplanade', x: 364, z: 121, radius: 185,
    source: 'https://www.visitsingapore.com/neighbourhood/featured-neighbourhood/marina-bay/esplanades-theatres-on-the-bay/',
    facts: [
      'Esplanade’s spiky domes earned it the nickname “the durian”. It is a performing arts centre.',
      'Esplanade hosts theatre, concerts and outdoor music along the waterfront.',
      'Makansutra Gluttons Bay beside Esplanade is known for open-air hawker dining.',
    ] },
  { id: 'padang', name: 'Padang · Civic District', x: 636, z: 120, radius: 190,
    source: 'https://www.roots.gov.sg/places/places-landing/Places/national-monuments/the-padang',
    facts: [
      'The Padang hosted independent Singapore’s first National Day Parade in 1966.',
      'The Padang is a historic open field and a gazetted National Monument.',
    ] },
  { id: 'river', name: 'Fullerton · Singapore River', x: 617, z: -308, radius: 190,
    source: 'https://www.fullertonhotels.com/the-fullerton-heritage-singapore/properties/the-fullerton-hotel-singapore',
    facts: [
      'The Fullerton Building dates from 1928 and once housed Singapore’s General Post Office.',
      'The Fullerton Building became a National Monument in 2015 and is now a hotel.',
    ] },
];
export const GENERAL_FACTS = [
  'Singapore hosted Formula One’s first night race in 2008.',
  'The Merlion’s fish body recalls Singapore’s fishing-village origins; its lion head represents Singapura.',
  'Around Marina Bay, you can find performing arts, historic buildings and waterfront views close together.',
];

export function zoneAt(x, z, previous = null) {
  const candidates = TOUR_ZONES.map(zone => ({ zone, distance: Math.hypot(x - zone.x, z - zone.z) / zone.radius }))
    .filter(item => item.distance <= 1).sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (!best) return null;
  const existing = candidates.find(item => item.zone.id === previous?.id);
  return existing && existing.distance < best.distance + 0.12 ? existing.zone : best.zone;
}

const BANTER = {
  idle: ['Engine ready, driver still buffering ah? W is the accelerator, lah.',
    'Aunty brought the commentary. You bring the movement, can?',
    'Pit-wall service very good today. Personal tour included with your lap.'],
  cruise: ['Nice and smooth. Wah, my imaginary kopi still in the cup.',
    'Look through the corner, then squeeze the throttle. Aunty wants a lap, not a pirouette.',
    'Good rhythm. You drive, I handle the unsolicited advice.',
    'Brake before the turn, power out gently. Even Aunty cannot negotiate with momentum.'],
  fast: ['Wah, now got pace! Save some brakes for the next corner, hor.',
    'That engine working overtime. Your eyes better do the same.',
    'Very fast, very confident. Remember the corner did not agree to move for you.'],
  boost: ['Extra power! Wah, suddenly got somewhere important to be.',
    'Boost on! Straighten the wheel first, Aunty’s hair already standing.'],
  brake: ['Big braking! Finish slowing down before you ask the tyres to turn, lah.',
    'Wah, serious brakes. My imaginary kopi nearly became a windscreen washer.'],
  corner: ['Gentle with the steering at this speed, hor. We are racing, not stirring noodles.',
    'Smooth hands. This corner needs patience, not a family argument.'],
};

export class TourDirector {
  constructor() {
    this.zone = null; this.candidate = null; this.candidateSince = 0;
    this.lastLocation = null; this.nextAt = 2; this.turns = 0;
    this.factIndices = new Map(); this.lineIndices = new Map(); this.factTimes = new Map();
    this.priority = null;
  }
  updateLocation(x, z, now) {
    const next = zoneAt(x, z, this.zone);
    if (next?.id !== this.candidate?.id) { this.candidate = next; this.candidateSince = now; }
    if (now - this.candidateSince > 0.8) this.zone = next;
    return this.zone;
  }
  queue(text, expression = 'idle') { this.priority = { text, expression, kind: 'race' }; }
  postpone(now, seconds = 2.5) { this.nextAt = Math.max(this.nextAt, now + seconds); }
  next(now, drive, speed, busy = false) {
    if (busy || now < this.nextAt) return null;
    let item = this.priority; this.priority = null;
    const zoneId = this.zone?.id || 'singapore';
    const entered = this.lastLocation !== zoneId;
    if (!item && (entered || this.turns % 2 === 0)) {
      const facts = this.zone?.facts || GENERAL_FACTS;
      const index = this.factIndices.get(zoneId) || 0;
      const factKey = `${zoneId}:${index % facts.length}`;
      if (now - (this.factTimes.get(factKey) ?? -Infinity) > 75) {
        const fact = facts[index % facts.length];
        const lead = this.zone ? `Around ${this.zone.name}: ` : 'A little Singapore story: ';
        item = { text: `${lead}${fact} ${speed > 14 ? 'Eyes on the road, sightseeing passenger is me!' : 'Tour guide and pit crew, Aunty doing two jobs today.'}`,
          fact, area: this.zone?.name || null, kind: 'landmark', expression: 'idle' };
        this.factIndices.set(zoneId, index + 1); this.factTimes.set(factKey, now);
      }
    }
    if (!item) {
      const style = drive.boosting ? 'boost' : drive.brake > 0.6 && speed > 6 ? 'brake'
        : Math.abs(drive.steering) > 0.6 && speed > 15 ? 'corner'
          : speed > 35 ? 'fast' : Math.abs(speed) < 1 ? 'idle' : 'cruise';
      const index = this.lineIndices.get(style) || 0;
      item = { text: BANTER[style][index % BANTER[style].length], kind: 'driving',
        expression: ['brake', 'corner'].includes(style) ? 'concerned' : style === 'boost' ? 'cheering' : 'idle' };
      this.lineIndices.set(style, index + 1);
    }
    this.turns++; this.lastLocation = zoneId;
    // Fallback subtitles remain readable; live playback schedules the next line
    // from output_audio_buffer.stopped instead of the model's generation finish.
    this.nextAt = now + Math.max(8, item.text.split(/\s+/).length / 2.7 + 2);
    return item;
  }
}
