# Racing and Aunty update

Open http://localhost:3000. The opening aerial shot blends into the rear camera,
then shows 3, 2, 1, GO. The car stays held until GO; the lap clock starts when
the car crosses the chequered stripe. R resets the car to the grid and repeats
the countdown. The stripe is now on the actual asphalt between the pit buildings
and grandstand, measured from the GLB with the scene inspector.

Hold W / Up to accelerate, S / Down to brake and then reverse, A / D to steer,
Space to brake without reversing, and Shift for rechargeable boost. The HUD shows
actual vehicle speed in km/h, automatic gear, RPM, throttle and boost. Steering
starts at Balanced; the slider allows a bounded Gentle–Responsive adjustment and
saves that preference locally. At high speed, steering lock remains reduced.

**The car, wind, tyre and countdown audio are disabled at the player's request.
Only Aunty's live voice is enabled.** The procedural sound implementation remains
unused in racing.mjs; the game does not create its audio context.

Click Talk to Aunty and permit the microphone. Automatic conversation is the
default. Hold V and release to send a turn if a noisy room interferes; this
switches the microphone to push-to-talk until the Mic button is clicked for auto.
The permanent OpenAI key stays in the local .env and Node server. The API model
remains gpt-realtime-1.5 with the marin voice. The speech bubble shows the audio
transcript; the mascot is visible throughout the opening and race.

Automatic commentary waits until playback finishes and pauses for player speech.
It rotates driving reactions and sourced Singapore stories. Six proximity zones
were anchored by ray-picking the supplied GLB: pit straight, Flyer, waterfront,
Esplanade, Padang and Fullerton riverfront. Short dwell times and hysteresis avoid
repeated boundary announcements. Facts do not repeat within 75 seconds. Outside
those zones, the commentary is framed as general Singapore history rather than
claiming a nearby landmark. The model contains the historic Float, so its facts
use the past tense.

Validation: `npm test` exercises the actual Rapier update functions with a mocked
HUD. It checks the countdown lock, translation under throttle, 0–100 acceleration,
braking, brief steering corrections, boost depletion/recharge, and tour scheduling.
The scene and voice connection were also checked in the local browser. The
environment still uses the existing flat physical floor beneath the visual GLB;
this update does not add mesh-accurate barriers or elevation collisions.

Sources for the short landmark facts:

- [Singapore Tourism Board: Singapore Flyer](https://www.visitsingapore.com/neighbourhood/featured-neighbourhood/marina-bay/singapore-flyer/)
- [Singapore Tourism Board: Esplanade](https://www.visitsingapore.com/neighbourhood/featured-neighbourhood/marina-bay/esplanades-theatres-on-the-bay/)
- [National Heritage Board: The Padang](https://www.roots.gov.sg/places/places-landing/Places/national-monuments/the-padang)
- [The Fullerton Heritage](https://www.fullertonhotels.com/the-fullerton-heritage-singapore/properties/the-fullerton-hotel-singapore)
- [MINDEF: history and redevelopment of The Float](https://www.mindef.gov.sg/news-and-events/latest-releases/19mar24_fs/)
- [URA: Marina Bay and the first night race](https://www.ura.gov.sg/land-planning/shaping-our-city/marina-bay/)
- [Singapore Tourism Board: Merlion Park](https://www.visitsingapore.com/neighbourhood/featured-neighbourhood/marina-bay/merlion-park/)
- [OpenAI: Realtime conversation and audio events](https://developers.openai.com/api/docs/guides/realtime-conversations)
