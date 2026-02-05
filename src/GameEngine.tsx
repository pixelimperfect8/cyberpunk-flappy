import { useEffect, useRef, useState } from 'react'

const GameEngine = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'GAME_OVER'>('START')
    const [score, setScore] = useState(0)

    // Game Constants
    const GRAVITY = 0.15
    const LIFT = -3.5
    const PIPE_SPEED = 2
    const PIPE_SPAWN_RATE = 150 // Frames between pipes
    const PIPE_GAP = 170

    // Refs for game loop state (to avoid closure staleness)
    const birdY = useRef(300)
    const birdVelocity = useRef(0)
    const pipes = useRef<{ x: number, topHeight: number, passed: boolean, destroyed?: boolean }[]>([])
    const frameCount = useRef(0)
    const animationFrameId = useRef<number>(0)

    // Power-up system
    const powerUpActive = useRef(false)
    const powerUpEndTime = useRef(0)
    const pill = useRef<{ x: number, y: number, rotation: number } | null>(null)
    const pillSpawnTimer = useRef(0)
    const projectiles = useRef<{ x: number, y: number }[]>([])


    const resetGame = () => {
        birdY.current = 300
        birdVelocity.current = 0
        pipes.current = []
        frameCount.current = 0
        powerUpActive.current = false
        powerUpEndTime.current = 0
        pill.current = null
        pillSpawnTimer.current = 0
        projectiles.current = []
        setScore(0)
        setGameState('START')
    }

    const startGame = () => {
        resetGame()
        setGameState('PLAYING')
    }

    const jump = () => {
        if (gameState === 'PLAYING') {
            birdVelocity.current = LIFT
            // Fire projectile if power-up is active
            if (powerUpActive.current) {
                projectiles.current.push({ x: 80, y: birdY.current + 15 })
            }
        } else if (gameState === 'START' || gameState === 'GAME_OVER') {
            startGame()
        }
    }

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' || e.code === 'ArrowUp') {
                e.preventDefault()
                jump()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [gameState])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const render = () => {
            // Global Animation Counter (independent of game state)
            const globalTime = Date.now() * 0.05

            // ===== NEO-TOKYO 3D PERSPECTIVE CITYSCAPE =====
            const W = canvas.width
            const H = canvas.height
            const HORIZON_Y = H * 0.35 // Horizon line
            const GROUND_Y = H - 20    // Ground level

            // Seeded random for consistent rendering
            const seededRand = (seed: number) => {
                const x = Math.sin(seed * 12.9898) * 43758.5453
                return x - Math.floor(x)
            }

            // --- SKY GRADIENT (Animated - subtle color shift) ---
            const timeShift = Math.sin(globalTime * 0.01) * 0.1
            const skyGrad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y + 150)
            skyGrad.addColorStop(0, '#0d0d1a')
            skyGrad.addColorStop(0.15, `hsl(240, 30%, ${8 + timeShift * 3}%)`)
            skyGrad.addColorStop(0.4, `hsl(210, 25%, ${18 + timeShift * 5}%)`)
            skyGrad.addColorStop(0.7, `hsl(200, 20%, ${28 + timeShift * 4}%)`)
            skyGrad.addColorStop(1, `hsl(190, 15%, ${35 + timeShift * 3}%)`)
            ctx.fillStyle = skyGrad
            ctx.fillRect(0, 0, W, H)

            // --- DISTANT CITY HAZE (atmospheric glow - animated) ---
            const hazeOffset = Math.sin(globalTime * 0.015) * 30
            const hazeGrad = ctx.createRadialGradient(W / 2 + hazeOffset, HORIZON_Y + 50, 0, W / 2, HORIZON_Y + 50, W * 0.7)
            hazeGrad.addColorStop(0, 'rgba(100, 160, 180, 0.3)')
            hazeGrad.addColorStop(0.3, 'rgba(80, 140, 160, 0.2)')
            hazeGrad.addColorStop(0.6, 'rgba(60, 100, 120, 0.1)')
            hazeGrad.addColorStop(1, 'rgba(30, 40, 50, 0)')
            ctx.fillStyle = hazeGrad
            ctx.fillRect(0, 0, W, H)

            // --- DRIFTING FOG LAYERS (multiple wispy layers) ---
            const drawFogLayer = (yBase: number, speed: number, alpha: number, scale: number) => {
                ctx.globalAlpha = alpha
                const fogOffset = (globalTime * speed) % (W * 2)

                for (let fx = -W; fx < W * 2; fx += 60 * scale) {
                    const fogY = yBase + Math.sin((fx + fogOffset) * 0.01) * 15
                    const fogW = 80 + Math.sin(fx * 0.02) * 30
                    const fogH = 8 + Math.sin(fx * 0.03) * 4

                    // Create soft fog gradient
                    const fogGrad = ctx.createRadialGradient(
                        fx - fogOffset + fogW / 2, fogY, 0,
                        fx - fogOffset + fogW / 2, fogY, fogW / 2
                    )
                    fogGrad.addColorStop(0, 'rgba(120, 140, 150, 0.4)')
                    fogGrad.addColorStop(0.5, 'rgba(100, 120, 130, 0.2)')
                    fogGrad.addColorStop(1, 'rgba(80, 100, 110, 0)')

                    ctx.fillStyle = fogGrad
                    ctx.beginPath()
                    ctx.ellipse(fx - fogOffset + fogW / 2, fogY, fogW * scale, fogH * scale, 0, 0, Math.PI * 2)
                    ctx.fill()
                }
                ctx.globalAlpha = 1
            }

            // Multiple fog layers at different heights and speeds
            drawFogLayer(HORIZON_Y - 30, 0.3, 0.15, 1.5)  // Upper fog (slow)
            drawFogLayer(HORIZON_Y + 20, 0.5, 0.12, 1.2)  // Mid fog
            drawFogLayer(HORIZON_Y + 80, 0.8, 0.08, 1.0)  // Lower fog (faster)

            // === BUILDING HELPER FUNCTION ===
            type BuildingDef = { x: number, w: number, h: number, depth: number, hasSign?: boolean, signText?: string, signVertical?: boolean }

            const drawBuilding3D = (b: BuildingDef) => {
                const baseColor = `rgb(${Math.floor(15 + b.depth * 12)}, ${Math.floor(15 + b.depth * 10)}, ${Math.floor(25 + b.depth * 8)})`
                const y = GROUND_Y - b.h

                // Main building body
                ctx.fillStyle = baseColor
                ctx.fillRect(b.x, y, b.w, b.h)

                // Architectural setbacks (tower on top)
                if (b.h > 150 && seededRand(b.x * 1.5) > 0.4) {
                    const setbackW = b.w * 0.6
                    const setbackH = b.h * 0.3
                    ctx.fillRect(b.x + (b.w - setbackW) / 2, y - setbackH, setbackW, setbackH)

                    // Antenna
                    ctx.fillStyle = '#333'
                    ctx.fillRect(b.x + b.w / 2 - 2, y - setbackH - 25, 4, 25)
                    ctx.fillStyle = '#ff0000'
                    ctx.fillRect(b.x + b.w / 2 - 2, y - setbackH - 25, 4, 4)
                }

                // Rooftop details
                ctx.fillStyle = `rgb(${Math.floor(10 + b.depth * 8)}, ${Math.floor(10 + b.depth * 6)}, ${Math.floor(15 + b.depth * 5)})`
                ctx.fillRect(b.x + 3, y - 6, 8, 6)
                ctx.fillRect(b.x + b.w - 12, y - 10, 6, 10)

                // Windows - varied colors based on depth
                const winColors = ['#00ffff', '#ff00ff', '#ffaa00', '#00ff88', '#ff6644']
                const winW = 3, winH = 4
                for (let wy = y + 8; wy < GROUND_Y - 8; wy += 7) {
                    for (let wx = b.x + 4; wx < b.x + b.w - 4; wx += 6) {
                        if (seededRand(wx * wy * 0.001 + b.x) > 0.3) {
                            const colorIdx = Math.floor(seededRand(wx + wy) * winColors.length)
                            ctx.fillStyle = winColors[colorIdx]
                            ctx.globalAlpha = 0.6 + seededRand(wx * wy) * 0.4
                            ctx.fillRect(wx, wy, winW, winH)
                        }
                    }
                }
                ctx.globalAlpha = 1

                // Neon Sign
                if (b.hasSign && b.signText) {
                    const signColor = seededRand(b.x * 2) > 0.5 ? '#ff00ff' : '#00ffff'
                    ctx.shadowColor = signColor
                    ctx.shadowBlur = 10
                    ctx.fillStyle = signColor

                    if (b.signVertical) {
                        // Vertical Japanese-style sign
                        ctx.font = 'bold 10px sans-serif'
                        const chars = b.signText.split('')
                        chars.forEach((char, i) => {
                            ctx.fillText(char, b.x + b.w + 3, y + 20 + i * 14)
                        })
                    } else {
                        // Horizontal billboard
                        ctx.fillStyle = '#151520'
                        const billW = b.w * 0.9
                        const billH = 20
                        const billY = y + 15
                        ctx.shadowBlur = 0
                        ctx.fillRect(b.x + (b.w - billW) / 2, billY, billW, billH)

                        ctx.shadowColor = signColor
                        ctx.shadowBlur = 8
                        ctx.fillStyle = signColor
                        ctx.font = 'bold 9px monospace'
                        ctx.fillText(b.signText, b.x + (b.w - billW) / 2 + 4, billY + 14)
                    }
                    ctx.shadowBlur = 0
                }
            }

            // === DEFINE ALL BUILDINGS (back to front) ===
            const buildings: BuildingDef[] = [
                // FAR BACKGROUND (Layer 5 - most hazy)
                { x: 30, w: 45, h: 220, depth: 5 },
                { x: 85, w: 55, h: 280, depth: 5, hasSign: true, signText: '宇宙中', signVertical: true },
                { x: 150, w: 40, h: 190, depth: 5 },
                { x: 200, w: 60, h: 350, depth: 5 },
                { x: 270, w: 50, h: 240, depth: 5 },
                { x: 330, w: 55, h: 300, depth: 5 },

                // LAYER 4
                { x: 10, w: 55, h: 180, depth: 4, hasSign: true, signText: 'NEO-TOKYO', signVertical: false },
                { x: 70, w: 48, h: 250, depth: 4 },
                { x: 130, w: 60, h: 200, depth: 4 },
                { x: 195, w: 45, h: 320, depth: 4, hasSign: true, signText: 'ラーメン', signVertical: true },
                { x: 250, w: 55, h: 230, depth: 4 },
                { x: 315, w: 50, h: 270, depth: 4 },
                { x: 370, w: 40, h: 200, depth: 4 },

                // LAYER 3
                { x: -10, w: 70, h: 160, depth: 3 },
                { x: 55, w: 65, h: 220, depth: 3, hasSign: true, signText: 'RAMEN', signVertical: false },
                { x: 125, w: 50, h: 180, depth: 3 },
                { x: 180, w: 70, h: 300, depth: 3, hasSign: true, signText: '全国航', signVertical: true },
                { x: 260, w: 55, h: 240, depth: 3 },
                { x: 320, w: 65, h: 190, depth: 3, hasSign: true, signText: 'CYBER', signVertical: false },
                { x: 390, w: 50, h: 220, depth: 3 },

                // LAYER 2
                { x: -20, w: 80, h: 140, depth: 2 },
                { x: 60, w: 75, h: 200, depth: 2, hasSign: true, signText: 'ネオ東京', signVertical: true },
                { x: 145, w: 60, h: 160, depth: 2 },
                { x: 210, w: 80, h: 280, depth: 2, hasSign: true, signText: 'CYBERNETICS', signVertical: false },
                { x: 300, w: 70, h: 210, depth: 2 },
                { x: 380, w: 60, h: 170, depth: 2 },

                // FOREGROUND (Layer 1 - darkest, closest)
                { x: -40, w: 100, h: 120, depth: 1 },
                { x: 70, w: 90, h: 180, depth: 1, hasSign: true, signText: 'イーパニス', signVertical: true },
                { x: 170, w: 85, h: 150, depth: 1 },
                { x: 270, w: 95, h: 200, depth: 1, hasSign: true, signText: '全国航', signVertical: true },
                { x: 375, w: 80, h: 140, depth: 1 },
            ]

            // Sort by depth (draw far buildings first)
            buildings.sort((a, b) => b.depth - a.depth)

            // Draw all buildings
            buildings.forEach(b => {
                ctx.globalAlpha = 0.4 + (1 - b.depth / 5) * 0.6 // Atmospheric fade
                drawBuilding3D(b)
            })
            ctx.globalAlpha = 1

            // === HORIZONTAL BRIDGES/WALKWAYS ===
            const bridges = [
                { y: GROUND_Y - 100, color: '#ff00ff' },
                { y: GROUND_Y - 180, color: '#00ffff' },
            ]
            bridges.forEach(br => {
                ctx.fillStyle = '#1a1a25'
                ctx.fillRect(0, br.y, W, 6)
                ctx.strokeStyle = br.color
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(0, br.y)
                ctx.lineTo(W, br.y)
                ctx.stroke()

                // Bridge supports (vertical)
                ctx.fillStyle = '#0d0d15'
                for (let bx = 50; bx < W; bx += 150) {
                    ctx.fillRect(bx, br.y, 4, GROUND_Y - br.y)
                }
            })

            // === FLYING VEHICLES ===
            const drawFlyingCar = (x: number, y: number, dir: number, size: number) => {
                const w = 20 * size
                const h = 6 * size
                ctx.fillStyle = '#2a2a4a'
                ctx.fillRect(x, y, w * dir, h)
                // Tail light
                ctx.fillStyle = '#ff4444'
                ctx.fillRect(x + (dir > 0 ? 1 : w - 3), y + h / 2 - 2, 3, 4)
                // Headlight
                ctx.fillStyle = '#ffffcc'
                ctx.shadowColor = '#ffffcc'
                ctx.shadowBlur = 4
                ctx.fillRect(x + (dir > 0 ? w - 4 : 1), y + h / 2 - 1, 3, 2)
                ctx.shadowBlur = 0
            }

            // Flying cars at various depths
            drawFlyingCar((globalTime * 1.5) % (W + 60) - 30, 85, 1, 0.8)
            drawFlyingCar(W - (globalTime * 2) % (W + 60), 140, -1, 1)
            drawFlyingCar((globalTime * 1 + 150) % (W + 60) - 30, 200, 1, 1.2)
            drawFlyingCar(W - (globalTime * 0.8 + 80) % (W + 60), 260, -1, 0.7)

            // === LARGE BILLBOARD SCREENS (prominent) ===
            // Left screen
            ctx.fillStyle = '#101018'
            ctx.fillRect(20, GROUND_Y - 350, 70, 45)
            const leftScreenGrad = ctx.createLinearGradient(20, GROUND_Y - 350, 90, GROUND_Y - 305)
            const screenPulse = (Math.sin(globalTime * 0.08) + 1) / 2
            leftScreenGrad.addColorStop(0, `rgba(0, 200, 255, ${0.5 + screenPulse * 0.3})`)
            leftScreenGrad.addColorStop(1, `rgba(100, 0, 200, ${0.5 + screenPulse * 0.3})`)
            ctx.fillStyle = leftScreenGrad
            ctx.fillRect(22, GROUND_Y - 348, 66, 41)
            ctx.fillStyle = '#ffffff'
            ctx.font = 'bold 8px monospace'
            ctx.fillText('SYSTEM', 28, GROUND_Y - 330)
            ctx.fillText('ONLINE', 28, GROUND_Y - 318)

            // Right screen  
            ctx.fillStyle = '#101018'
            ctx.fillRect(310, GROUND_Y - 280, 75, 50)
            const rightScreenGrad = ctx.createLinearGradient(310, GROUND_Y - 280, 385, GROUND_Y - 230)
            rightScreenGrad.addColorStop(0, `rgba(255, 100, 0, ${0.4 + screenPulse * 0.4})`)
            rightScreenGrad.addColorStop(1, `rgba(255, 0, 100, ${0.4 + screenPulse * 0.4})`)
            ctx.fillStyle = rightScreenGrad
            ctx.fillRect(312, GROUND_Y - 278, 71, 46)
            ctx.fillStyle = '#ffffff'
            ctx.font = 'bold 9px monospace'
            ctx.fillText('NEURAL-NET', 318, GROUND_Y - 255)
            ctx.fillText('v3.7.2', 330, GROUND_Y - 242)

            // === GROUND (Rooftop perspective) ===
            ctx.fillStyle = '#080810'
            ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y)

            // Neon edge line
            ctx.strokeStyle = '#00ffff'
            ctx.shadowColor = '#00ffff'
            ctx.shadowBlur = 6
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(0, GROUND_Y)
            ctx.lineTo(W, GROUND_Y)
            ctx.stroke()
            ctx.shadowBlur = 0

            // Ground grid lines (perspective)
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)'
            ctx.lineWidth = 1
            const gridOffset = (globalTime * 0.3) % 15
            for (let gx = -15; gx < W + 15; gx += 15) {
                ctx.beginPath()
                ctx.moveTo(gx - gridOffset, GROUND_Y)
                ctx.lineTo(gx - gridOffset - 8, H)
                ctx.stroke()
            }

            // === ROTATING BEACON LIGHTS ===
            const beaconPositions = [
                { x: 95, y: GROUND_Y - 340 },   // Tall building left
                { x: 230, y: GROUND_Y - 420 },  // Central tower
                { x: 350, y: GROUND_Y - 310 },  // Right building
            ]

            beaconPositions.forEach((beacon, idx) => {
                const beaconAngle = (globalTime * 0.03 + idx * 2.1) % (Math.PI * 2)

                // Red beacon light (the bulb)
                ctx.fillStyle = '#ff0000'
                ctx.shadowColor = '#ff0000'
                ctx.shadowBlur = 10
                ctx.beginPath()
                ctx.arc(beacon.x, beacon.y, 4, 0, Math.PI * 2)
                ctx.fill()
                ctx.shadowBlur = 0

                // Sweeping light beam
                const beamLength = 150
                const beamWidth = 0.25 // Radians

                // Create gradient for light beam
                const beamGrad = ctx.createRadialGradient(beacon.x, beacon.y, 0, beacon.x, beacon.y, beamLength)
                beamGrad.addColorStop(0, 'rgba(255, 50, 50, 0.4)')
                beamGrad.addColorStop(0.3, 'rgba(255, 30, 30, 0.2)')
                beamGrad.addColorStop(1, 'rgba(255, 0, 0, 0)')

                ctx.fillStyle = beamGrad
                ctx.beginPath()
                ctx.moveTo(beacon.x, beacon.y)
                ctx.lineTo(
                    beacon.x + Math.cos(beaconAngle - beamWidth) * beamLength,
                    beacon.y + Math.sin(beaconAngle - beamWidth) * beamLength
                )
                ctx.lineTo(
                    beacon.x + Math.cos(beaconAngle + beamWidth) * beamLength,
                    beacon.y + Math.sin(beaconAngle + beamWidth) * beamLength
                )
                ctx.closePath()
                ctx.fill()
            })

            // === FOREGROUND FOG LAYER (bottom, in front of everything) ===
            const fgFogOffset = (globalTime * 0.4) % (W * 1.5)
            ctx.globalAlpha = 0.25

            // Draw wispy fog patches at the bottom
            for (let fx = -100; fx < W + 200; fx += 40) {
                const fogY = GROUND_Y - 30 + Math.sin((fx + fgFogOffset) * 0.015) * 12
                const fogW = 70 + Math.sin(fx * 0.03 + globalTime * 0.01) * 25
                const fogH = 18 + Math.sin(fx * 0.02) * 6

                // Soft fog gradient
                const fgFogGrad = ctx.createRadialGradient(
                    fx - fgFogOffset + fogW / 2, fogY, 0,
                    fx - fgFogOffset + fogW / 2, fogY, fogW / 1.5
                )
                fgFogGrad.addColorStop(0, 'rgba(80, 100, 120, 0.5)')
                fgFogGrad.addColorStop(0.4, 'rgba(60, 80, 100, 0.3)')
                fgFogGrad.addColorStop(1, 'rgba(40, 60, 80, 0)')

                ctx.fillStyle = fgFogGrad
                ctx.beginPath()
                ctx.ellipse(fx - fgFogOffset + fogW / 2, fogY, fogW, fogH, 0, 0, Math.PI * 2)
                ctx.fill()
            }

            // Additional dense fog layer right at ground level
            const groundFogGrad = ctx.createLinearGradient(0, GROUND_Y - 50, 0, GROUND_Y + 10)
            groundFogGrad.addColorStop(0, 'rgba(60, 80, 100, 0)')
            groundFogGrad.addColorStop(0.5, 'rgba(70, 90, 110, 0.25)')
            groundFogGrad.addColorStop(1, 'rgba(80, 100, 120, 0.4)')
            ctx.fillStyle = groundFogGrad
            ctx.fillRect(0, GROUND_Y - 50, W, 60)

            ctx.globalAlpha = 1

            // Draw Bird (with glow when powered up)
            if (powerUpActive.current) {
                ctx.shadowColor = '#00ff00'
                ctx.shadowBlur = 15
                ctx.fillStyle = '#88ff88'
            } else {
                ctx.fillStyle = '#fdb'
            }
            ctx.fillRect(50, birdY.current, 30, 30)
            ctx.shadowBlur = 0

            if (gameState === 'PLAYING') {
                // Check power-up timer
                if (powerUpActive.current && Date.now() > powerUpEndTime.current) {
                    powerUpActive.current = false
                }

                // Physics
                birdVelocity.current += GRAVITY
                birdY.current += birdVelocity.current

                // === PILL SPAWN & UPDATE ===
                pillSpawnTimer.current++
                // Spawn pill every ~500 frames if none exists, positioned in the gap of an existing pipe
                if (!pill.current && pillSpawnTimer.current > 500 && Math.random() < 0.02 && pipes.current.length > 0) {
                    // Find the rightmost pipe and spawn pill in its gap
                    const lastPipe = pipes.current[pipes.current.length - 1]
                    const gapCenter = lastPipe.topHeight + PIPE_GAP / 2
                    pill.current = {
                        x: canvas.width + 20,
                        y: gapCenter - 10, // Center in the gap
                        rotation: 0
                    }
                    pillSpawnTimer.current = 0
                }

                // Update and draw pill
                if (pill.current) {
                    pill.current.x -= PIPE_SPEED * 0.8
                    pill.current.rotation += 0.1
                    pill.current.y += Math.sin(globalTime * 0.1) * 0.5 // Float up/down

                    // Draw 3D rotating tablet (round disc style)
                    const px = pill.current.x
                    const py = pill.current.y
                    const rot = pill.current.rotation
                    const tabletRadius = 18
                    // Width varies with rotation to create 3D spinning effect
                    const tabletWidth = Math.abs(Math.cos(rot)) * tabletRadius + 4
                    const tabletHeight = tabletRadius

                    // Tablet shadow
                    ctx.fillStyle = 'rgba(0, 80, 0, 0.4)'
                    ctx.beginPath()
                    ctx.ellipse(px + 4, py + tabletRadius + 8, tabletWidth * 0.7, 5, 0, 0, Math.PI * 2)
                    ctx.fill()

                    // Tablet body (3D disc - draw as ellipse that changes width)
                    const tabletGrad = ctx.createLinearGradient(px - tabletWidth, py, px + tabletWidth, py)
                    tabletGrad.addColorStop(0, '#1a6b1a')
                    tabletGrad.addColorStop(0.3, '#33cc33')
                    tabletGrad.addColorStop(0.5, '#55ee55')
                    tabletGrad.addColorStop(0.7, '#33cc33')
                    tabletGrad.addColorStop(1, '#1a6b1a')

                    ctx.fillStyle = tabletGrad
                    ctx.beginPath()
                    ctx.ellipse(px, py, tabletWidth, tabletHeight, 0, 0, Math.PI * 2)
                    ctx.fill()

                    // Tablet edge (3D thickness effect)
                    ctx.fillStyle = '#228822'
                    ctx.beginPath()
                    ctx.ellipse(px, py + 3, tabletWidth * 0.95, tabletHeight * 0.4, 0, 0, Math.PI)
                    ctx.fill()

                    // Center emboss/stamp (like real pills have)
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
                    ctx.beginPath()
                    ctx.ellipse(px, py - 2, tabletWidth * 0.4, tabletHeight * 0.35, 0, 0, Math.PI * 2)
                    ctx.fill()

                    // Highlight shine
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
                    ctx.beginPath()
                    ctx.ellipse(px - tabletWidth * 0.3, py - tabletHeight * 0.4, 4, 3, -0.5, 0, Math.PI * 2)
                    ctx.fill()

                    // Glow effect
                    ctx.shadowColor = '#00ff00'
                    ctx.shadowBlur = 15
                    ctx.strokeStyle = '#44ff44'
                    ctx.lineWidth = 2
                    ctx.beginPath()
                    ctx.ellipse(px, py, tabletWidth + 4, tabletHeight + 4, 0, 0, Math.PI * 2)
                    ctx.stroke()
                    ctx.shadowBlur = 0

                    // Collision with bird (using larger radius for tablet)
                    if (
                        50 < px + tabletWidth && 50 + 30 > px - tabletWidth &&
                        birdY.current < py + tabletHeight && birdY.current + 30 > py - tabletHeight
                    ) {
                        powerUpActive.current = true
                        powerUpEndTime.current = Date.now() + 5000 // 5 seconds
                        pill.current = null
                    }

                    // Remove if off-screen
                    if (pill.current && pill.current.x < -50) {
                        pill.current = null
                    }
                }

                // === PROJECTILES UPDATE ===
                for (let i = projectiles.current.length - 1; i >= 0; i--) {
                    const proj = projectiles.current[i]
                    proj.x += 8 // Projectile speed

                    // Draw projectile (white droplet)
                    ctx.shadowColor = '#ffffff'
                    ctx.shadowBlur = 10
                    ctx.fillStyle = '#ffffff'
                    ctx.beginPath()
                    // Droplet shape (teardrop pointing right)
                    ctx.moveTo(proj.x + 12, proj.y)
                    ctx.quadraticCurveTo(proj.x, proj.y - 6, proj.x, proj.y)
                    ctx.quadraticCurveTo(proj.x, proj.y + 6, proj.x + 12, proj.y)
                    ctx.fill()
                    // Inner bright spot
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
                    ctx.beginPath()
                    ctx.arc(proj.x + 4, proj.y, 3, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.shadowBlur = 0

                    // Check collision with pipes
                    for (let j = pipes.current.length - 1; j >= 0; j--) {
                        const p = pipes.current[j]
                        if (!p.destroyed && proj.x + 15 > p.x && proj.x < p.x + 50) {
                            // Hit top pipe
                            if (proj.y < p.topHeight) {
                                p.destroyed = true
                                projectiles.current.splice(i, 1)
                                break
                            }
                            // Hit bottom pipe
                            if (proj.y > p.topHeight + PIPE_GAP) {
                                p.destroyed = true
                                projectiles.current.splice(i, 1)
                                break
                            }
                        }
                    }

                    // Remove if off-screen
                    if (proj.x > canvas.width + 20) {
                        projectiles.current.splice(i, 1)
                    }
                }

                // Pipe Logic
                frameCount.current++
                if (frameCount.current % PIPE_SPAWN_RATE === 0) {
                    const minPipe = 50
                    const maxPipe = canvas.height - PIPE_GAP - 50 - 20 // -ground
                    const height = Math.floor(Math.random() * (maxPipe - minPipe + 1)) + minPipe
                    pipes.current.push({ x: canvas.width, topHeight: height, passed: false })
                }

                // Update Pipes
                for (let i = pipes.current.length - 1; i >= 0; i--) {
                    const p = pipes.current[i]
                    p.x -= PIPE_SPEED

                    if (!p.destroyed) {
                        // Draw Pipes
                        ctx.fillStyle = '#73bf2e'
                        // Top Pipe
                        ctx.fillRect(p.x, 0, 50, p.topHeight)
                        // Bottom Pipe
                        ctx.fillRect(p.x, p.topHeight + PIPE_GAP, 50, canvas.height - (p.topHeight + PIPE_GAP) - 20)

                        // Collision Detection
                        // Bird Box: 50, birdY, 30, 30
                        if (
                            50 < p.x + 50 &&
                            50 + 30 > p.x &&
                            (birdY.current < p.topHeight || birdY.current + 30 > p.topHeight + PIPE_GAP)
                        ) {
                            setGameState('GAME_OVER')
                        }
                    } else {
                        // Draw destroyed pipe debris (explosion effect)
                        ctx.fillStyle = '#556633'
                        for (let d = 0; d < 5; d++) {
                            const dx = p.x + Math.sin(d * 1.5 + globalTime * 0.2) * 20
                            const dy = p.topHeight / 2 + Math.cos(d * 2 + globalTime * 0.3) * 30
                            ctx.fillRect(dx, dy, 8, 8)
                        }
                    }

                    // Score
                    if (p.x + 50 < 50 && !p.passed) {
                        setScore(prev => prev + 1)
                        p.passed = true
                    }

                    // Remove off-screen pipes
                    if (p.x < -60) {
                        pipes.current.splice(i, 1)
                    }
                }

                // Draw power-up indicator
                if (powerUpActive.current) {
                    const timeLeft = Math.ceil((powerUpEndTime.current - Date.now()) / 1000)
                    ctx.fillStyle = '#00ff00'
                    ctx.shadowColor = '#00ff00'
                    ctx.shadowBlur = 8
                    ctx.font = 'bold 16px monospace'
                    ctx.fillText(`⚡ POWER: ${timeLeft}s`, 10, 50)
                    ctx.font = '12px monospace'
                    ctx.fillText('(Jump to shoot!)', 10, 68)
                    ctx.shadowBlur = 0
                }

                // Floor/Ceiling Collision
                if (birdY.current + 30 >= canvas.height - 20 || birdY.current < 0) {
                    setGameState('GAME_OVER')
                }
            } else if (gameState === 'START') {
                ctx.fillStyle = 'white'
                ctx.font = '30px Arial'
                ctx.fillText('Click to Start', canvas.width / 2 - 80, canvas.height / 2)
                ctx.font = '20px Arial'
                ctx.fillText('or Press Space', canvas.width / 2 - 60, canvas.height / 2 + 30)
            } else if (gameState === 'GAME_OVER') {
                // Draw accumulated pipes even when paused
                pipes.current.forEach(p => {
                    ctx.fillStyle = '#73bf2e'
                    ctx.fillRect(p.x, 0, 50, p.topHeight)
                    ctx.fillRect(p.x, p.topHeight + PIPE_GAP, 50, canvas.height - (p.topHeight + PIPE_GAP) - 20)
                })

                ctx.fillStyle = 'white'
                ctx.font = '30px Arial'
                ctx.fillText('Game Over', canvas.width / 2 - 70, canvas.height / 2)
                ctx.font = '20px Arial'
                ctx.fillText(`Score: ${score}`, canvas.width / 2 - 40, canvas.height / 2 + 40)
                ctx.fillText('Press Space to Restart', canvas.width / 2 - 90, canvas.height / 2 + 70)
            }

            animationFrameId.current = requestAnimationFrame(render)
        }

        render()

        return () => {
            cancelAnimationFrame(animationFrameId.current)
        }
    }, [gameState, score])

    return (
        <div
            onClick={jump}
            style={{
                width: '100vw',
                height: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                userSelect: 'none',
                outline: 'none',
                background: '#0a0a12'
            }}
        >
            <canvas
                ref={canvasRef}
                width={400}
                height={600}
                style={{
                    border: '2px solid #00ffff',
                    borderRadius: '8px',
                    boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)'
                }}
            />
            <div style={{ position: 'absolute', top: 20, color: '#00ffff', fontSize: '28px', fontWeight: 'bold', textShadow: '0 0 10px #00ffff' }}>
                {score}
            </div>
            <div style={{ position: 'absolute', bottom: 20, color: '#666', fontSize: '14px' }}>
                Space or Click to Jump • Collect green pill for power-up!
            </div>
        </div>
    )
}

export default GameEngine
