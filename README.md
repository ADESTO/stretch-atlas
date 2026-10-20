# Stretch Atlas

An interactive 3D movement and anatomy lab for trainers. Pose a real anatomical body, play and compare walking patterns, explore evidence-graded links between movement and pain, and demonstrate stretches, strengthening and movement-control exercises screened for warning signs, age and health conditions.

Built with Three.js on meshes from [Z-Anatomy](https://github.com/LluisV/Z-Anatomy).

## What it does

- **Real anatomy.** 278 muscles and fascia structures and 248 bones from Z-Anatomy, simplified and skinned to a 15-joint rig. The pelvis tilts, drops and rotates independently of the legs and trunk.
- **Live muscle length.** Each muscle's centre line, plus bone-anchored tendon attachments for joint-crossing muscles, is measured every frame as the body moves. Colour by stretch targets or by length change.
- **Exercise atlas.** 22 stretches plus 15 strengthening and movement-control exercises, each with target muscles, cues, dosage and precautions. Strength and control exercises loop through their movement. Every curated muscle links to the stretches, strength exercises and drills that use it.
- **Gait lab.** Play, pause and scrub a walking cycle. Compare reference, foot-led, knee-led and hip-led patterns, with a ghost outline and angle charts for the comparison. Thirteen sliders adjust push-off, knee bend, pelvic drop, trunk lean, stiff calf, stiff hip flexors and more. Colours show muscles typically active in each phase (from published EMG patterns). The effects panel labels every value as computed by the model, from research (direction only), or not modelled.
- **Gait-to-pain explorer.** Nine pathways across the knee, outer hip, lower back, calf, heel and shin. Each has a mechanism, linked studies (design, sample, finding, limits), an evidence-strength grade, a causal level (from idea only to changing it helped in a trial), alternative explanations, a demo in the gait lab and linked exercises.
- **Direct posing.** Drag the hands and feet (two-bone IK) or use joint sliders limited to typical healthy ranges of motion.
- **Pain screen.** Tap the body or choose one of 17 areas. Answer what it feels like, how bad it is, the age band, conditions and area-specific warning signs. Red flags hide all stretches and say what level of care to seek. Conditions such as osteoporosis, pregnancy, joint replacements and disc problems remove or flag specific stretches.
- **AI instructor.** When the page runs as a Claude artifact, Claude drives the model through page tools (demonstrate, pose, select, mark pain, walk, open pathway) and follows the pain screen and evidence grades. Anywhere else it falls back to a keyword-matching library mode.

## Run it locally

The page fetches `atlas.txt`, so it needs a web server rather than opening the file directly:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publish with GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

On GitHub Pages the instructor runs in library mode, since the Claude connection only exists inside claude.ai artifacts.

## Rebuild the model

`atlas.txt` is the packed model: positions quantised to 16 bits, two bone weights per vertex, gzipped then base64-encoded. To rebuild it from the source FBX files:

```bash
git clone --depth 1 https://github.com/LluisV/z-anatomy
cd build
npm install
export ZA="../z-anatomy/Z-Anatomy PC/Assets/Models/1.0 Models"
export PATH="$PWD/node_modules/fbx2gltf/bin/Linux:$PATH"   # use Darwin on macOS
npm run convert
npm run build
```

`build.mjs` filters out fascia, bursae, sheaths and small deep structures, welds and simplifies each mesh with meshoptimizer, finds joint centres from the bones (sphere fits for the femoral and humeral heads), assigns skin weights by distance to capsule-shaped limb segments, and maps meshes to the curated muscle groups. Set `MB` and `BB` to change the muscle and bone vertex budgets (defaults 170000 and 90000).

## Important limits

- This is a teaching tool, not a diagnostic or medical device. The screening rules are simplified from common guidance and should be reviewed by a physiotherapist before clients rely on them.
- Length changes are model estimates from linear-blend skinning, not measured biomechanics. The model calculates no forces, joint moments or muscle activation.
- Gait curves are approximate shapes based on typical adult walking, adapted so the rigid model foot stays in contact and clears the floor. Foot-, knee- and hip-led patterns are teaching archetypes, not validated clinical categories.
- Evidence summaries were checked against the sources in October 2026 but are short summaries; read the linked papers before relying on them.
- The spine bends at only two points (lower back and neck), so lower-back length changes read small. The forearm cannot rotate, so palm-down stretches show the palm up.
- Nothing typed in the pain screen is stored.

## Licence

The anatomical meshes and the derived `atlas.txt` come from Z-Anatomy by Lluís Vinent and contributors, based on BodyParts3D (DBCLS), and are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Any redistributed or modified version of the model data must keep this attribution and use the same licence.
