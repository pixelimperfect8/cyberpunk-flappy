---
description: Add a new image or audio asset to GameEngine.tsx with proper loading
---

# Add Asset to Game

When the user wants to add a new asset (image or audio), follow these steps:

1. **Verify the asset exists** in `public/`. List the directory to confirm the filename.

2. **Determine asset type:**
   - **Image**: Add a `useRef<HTMLImageElement | null>(null)` near the other sprite refs (~lines 128-155 in GameEngine.tsx).
   - **Audio**: Add a `useRef<HTMLAudioElement | null>(null)` near the other audio refs (~line 292 in GameEngine.tsx).

3. **Add loading logic:**
   - **Image**: In the `// Load sprites` useEffect (~line 438), add:
     ```tsx
     const img = new Image()
     img.src = '/<filename>'
     img.onload = () => { refName.current = img }
     ```
   - **Audio**: Add an `<audio>` JSX element at the bottom of the component return (near line 3330), and integrate volume control in the `updateAudio` function (~line 304).

4. **Run build check** (`/build-check`) to verify no TypeScript errors.

5. Ask the user where/how they want to use the asset in the game before writing render or playback logic.
