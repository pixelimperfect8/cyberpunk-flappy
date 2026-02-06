import { useEffect, useRef, useState, useCallback } from 'react'

const GameEngine = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'PAUSED' | 'GAME_OVER'>('START')
    const [score, setScore] = useState(0)
    const [canvasSize, setCanvasSize] = useState({ width: 400, height: 600 })
    const [isMuted, setIsMuted] = useState(false)

    // Game Constants (will be scaled based on canvas size)
    const BASE_HEIGHT = 600
    const getScale = useCallback(() => canvasSize.height / BASE_HEIGHT, [canvasSize.height])

    const GRAVITY = 0.15
    const LIFT = -3.5
    const PIPE_SPEED = 2.5  // Slightly faster
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

    // Acid rain system
    const gameStartTime = useRef(0)
    const rainDrops = useRef<{ x: number, y: number, speed: number, length: number, vx: number }[]>([])
    const splashParticles = useRef<{ x: number, y: number, vx: number, vy: number, life: number, color: string }[]>([])
    const ACID_RAIN_DELAY = 15000 // 15 seconds before acid rain starts

    // Audio
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const toggleMute = (e: React.MouseEvent) => {
        e.stopPropagation() // Prevent triggering jump
        setIsMuted(prev => {
            if (audioRef.current) {
                audioRef.current.muted = !prev
            }
            return !prev
        })
    }

    // Resize handler
    useEffect(() => {
        const handleResize = () => {
            const vh = window.innerHeight
            const aspectRatio = 400 / 600 // Original aspect ratio
            const newHeight = vh - 40 // Leave some padding
            const newWidth = newHeight * aspectRatio
            setCanvasSize({ width: Math.floor(newWidth), height: Math.floor(newHeight) })
        }
        handleResize()
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    const resetGame = () => {
        const scale = getScale()
        birdY.current = 300 * scale
        birdVelocity.current = 0
        pipes.current = []
        frameCount.current = 0
        powerUpActive.current = false
        powerUpEndTime.current = 0
        pill.current = null
        pillSpawnTimer.current = 0
        projectiles.current = []
        // Reset acid rain
        rainDrops.current = []
        splashParticles.current = []
        gameStartTime.current = 0
        setScore(0)
        setGameState('START')
    }

    const startGame = () => {
        resetGame()
        setGameState('PLAYING')
        gameStartTime.current = Date.now() // Track when game started for acid rain
        // Start background music
        if (audioRef.current) {
            audioRef.current.currentTime = 0
            audioRef.current.play().catch(() => { })
        }
    }

    const jump = () => {
        if (gameState === 'PLAYING') {
            const scale = getScale()
            birdVelocity.current = LIFT * scale
            // Fire projectile if power-up is active
            if (powerUpActive.current) {
                projectiles.current.push({ x: 80 * scale, y: birdY.current + 15 * scale })
            }
        } else if (gameState === 'START' || gameState === 'GAME_OVER') {
            startGame()
        } else if (gameState === 'PAUSED') {
            setGameState('PLAYING')
        }
    }

    const togglePause = () => {
        if (gameState === 'PLAYING') {
            setGameState('PAUSED')
        } else if (gameState === 'PAUSED') {
            setGameState('PLAYING')
        }
    }

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' || e.code === 'ArrowUp') {
                e.preventDefault()
                jump()
            } else if (e.code === 'Escape' || e.code === 'Enter') {
                e.preventDefault()
                togglePause()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [gameState, canvasSize])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const scale = getScale()
        const scaledGravity = GRAVITY * scale
        const scaledPipeSpeed = PIPE_SPEED * scale
        const scaledPipeGap = PIPE_GAP * scale
        const scaledBirdSize = 30 * scale
        const scaledBirdX = 50 * scale
        const scaledPipeWidth = 50 * scale

        const render = () => {
            // Global Animation Counter (independent of game state)
            const globalTime = Date.now() * 0.05

            // ===== NEO-TOKYO 3D PERSPECTIVE CITYSCAPE =====
            const W = canvas.width
            const H = canvas.height
            const HORIZON_Y = H * 0.35 // Horizon line
            const GROUND_Y = H - 20 * scale    // Ground level

            // Seeded random for consistent rendering
            const seededRand = (seed: number) => {
                const x = Math.sin(seed * 12.9898) * 43758.5453
                return x - Math.floor(x)
            }

            // --- SKY GRADIENT (Animated - subtle color shift) ---
            const timeShift = Math.sin(globalTime * 0.01) * 0.1
            const skyGrad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y + 150 * scale)
            skyGrad.addColorStop(0, '#0d0d1a')
            skyGrad.addColorStop(0.15, `hsl(240, 30%, ${8 + timeShift * 3}%)`)
            skyGrad.addColorStop(0.4, `hsl(210, 25%, ${18 + timeShift * 5}%)`)
            skyGrad.addColorStop(0.7, `hsl(200, 20%, ${28 + timeShift * 4}%)`)
            skyGrad.addColorStop(1, `hsl(190, 15%, ${35 + timeShift * 3}%)`)
            ctx.fillStyle = skyGrad
            ctx.fillRect(0, 0, W, H)

            // --- DISTANT CITY HAZE (atmospheric glow - animated) ---
            const hazeOffset = Math.sin(globalTime * 0.015) * 30 * scale
            const hazeGrad = ctx.createRadialGradient(W / 2 + hazeOffset, HORIZON_Y + 50 * scale, 0, W / 2, HORIZON_Y + 50 * scale, W * 0.7)
            hazeGrad.addColorStop(0, 'rgba(100, 160, 180, 0.3)')
            hazeGrad.addColorStop(0.3, 'rgba(80, 140, 160, 0.2)')
            hazeGrad.addColorStop(0.6, 'rgba(60, 100, 120, 0.1)')
            hazeGrad.addColorStop(1, 'rgba(30, 40, 50, 0)')
            ctx.fillStyle = hazeGrad
            ctx.fillRect(0, 0, W, H)

            // --- DRIFTING FOG LAYERS (multiple wispy layers) ---
            const drawFogLayer = (yBase: number, speed: number, alpha: number, fogScale: number) => {
                ctx.globalAlpha = alpha
                const fogOffset = (globalTime * speed) % (W * 2)

                for (let fx = -W; fx < W * 2; fx += 60 * fogScale * scale) {
                    const fogY = yBase + Math.sin((fx + fogOffset) * 0.01) * 15 * scale
                    const fogW = (80 + Math.sin(fx * 0.02) * 30) * scale
                    const fogH = (8 + Math.sin(fx * 0.03) * 4) * scale

                    const fogGrad = ctx.createRadialGradient(
                        fx - fogOffset + fogW / 2, fogY, 0,
                        fx - fogOffset + fogW / 2, fogY, fogW / 2
                    )
                    fogGrad.addColorStop(0, 'rgba(120, 140, 150, 0.4)')
                    fogGrad.addColorStop(0.5, 'rgba(100, 120, 130, 0.2)')
                    fogGrad.addColorStop(1, 'rgba(80, 100, 110, 0)')

                    ctx.fillStyle = fogGrad
                    ctx.beginPath()
                    ctx.ellipse(fx - fogOffset + fogW / 2, fogY, fogW * fogScale, fogH * fogScale, 0, 0, Math.PI * 2)
                    ctx.fill()
                }
                ctx.globalAlpha = 1
            }

            drawFogLayer(HORIZON_Y - 30 * scale, 0.3, 0.15, 1.5)
            drawFogLayer(HORIZON_Y + 20 * scale, 0.5, 0.12, 1.2)
            drawFogLayer(HORIZON_Y + 80 * scale, 0.8, 0.08, 1.0)

            // === BUILDING HELPER FUNCTION ===
            type BuildingDef = { x: number, w: number, h: number, depth: number, hasSign?: boolean, signText?: string, signVertical?: boolean }

            const drawBuilding3D = (b: BuildingDef) => {
                const bx = b.x * scale
                const bw = b.w * scale
                const bh = b.h * scale
                const baseColor = `rgb(${Math.floor(15 + b.depth * 12)}, ${Math.floor(15 + b.depth * 10)}, ${Math.floor(25 + b.depth * 8)})`
                const y = GROUND_Y - bh

                ctx.fillStyle = baseColor
                ctx.fillRect(bx, y, bw, bh)

                if (bh > 150 * scale && seededRand(b.x * 1.5) > 0.4) {
                    const setbackW = bw * 0.6
                    const setbackH = bh * 0.3
                    ctx.fillRect(bx + (bw - setbackW) / 2, y - setbackH, setbackW, setbackH)

                    ctx.fillStyle = '#333'
                    ctx.fillRect(bx + bw / 2 - 2 * scale, y - setbackH - 25 * scale, 4 * scale, 25 * scale)
                    ctx.fillStyle = '#ff0000'
                    ctx.fillRect(bx + bw / 2 - 2 * scale, y - setbackH - 25 * scale, 4 * scale, 4 * scale)
                }

                ctx.fillStyle = `rgb(${Math.floor(10 + b.depth * 8)}, ${Math.floor(10 + b.depth * 6)}, ${Math.floor(15 + b.depth * 5)})`
                ctx.fillRect(bx + 3 * scale, y - 6 * scale, 8 * scale, 6 * scale)
                ctx.fillRect(bx + bw - 12 * scale, y - 10 * scale, 6 * scale, 10 * scale)

                const winColors = ['#00ffff', '#ff00ff', '#ffaa00', '#00ff88', '#ff6644']
                const winW = 3 * scale, winH = 4 * scale
                for (let wy = y + 8 * scale; wy < GROUND_Y - 8 * scale; wy += 7 * scale) {
                    for (let wx = bx + 4 * scale; wx < bx + bw - 4 * scale; wx += 6 * scale) {
                        if (seededRand(wx * wy * 0.001 + b.x) > 0.3) {
                            const colorIdx = Math.floor(seededRand(wx + wy) * winColors.length)
                            ctx.fillStyle = winColors[colorIdx]
                            ctx.globalAlpha = 0.6 + seededRand(wx * wy) * 0.4
                            ctx.fillRect(wx, wy, winW, winH)
                        }
                    }
                }
                ctx.globalAlpha = 1

                if (b.hasSign && b.signText) {
                    const signColor = seededRand(b.x * 2) > 0.5 ? '#ff00ff' : '#00ffff'
                    ctx.shadowColor = signColor
                    ctx.shadowBlur = 10 * scale
                    ctx.fillStyle = signColor

                    if (b.signVertical) {
                        ctx.font = `bold ${10 * scale}px sans-serif`
                        const chars = b.signText.split('')
                        chars.forEach((char, i) => {
                            ctx.fillText(char, bx + bw + 3 * scale, y + 20 * scale + i * 14 * scale)
                        })
                    } else {
                        ctx.fillStyle = '#151520'
                        const billW = bw * 0.9
                        const billH = 20 * scale
                        const billY = y + 15 * scale
                        ctx.shadowBlur = 0
                        ctx.fillRect(bx + (bw - billW) / 2, billY, billW, billH)

                        ctx.shadowColor = signColor
                        ctx.shadowBlur = 8 * scale
                        ctx.fillStyle = signColor
                        ctx.font = `bold ${9 * scale}px monospace`
                        ctx.fillText(b.signText, bx + (bw - billW) / 2 + 4 * scale, billY + 14 * scale)
                    }
                    ctx.shadowBlur = 0
                }
            }

            const buildings: BuildingDef[] = [
                { x: 30, w: 45, h: 220, depth: 5 },
                { x: 85, w: 55, h: 280, depth: 5, hasSign: true, signText: 'å®‡å®™ä¸­', signVertical: true },
                { x: 150, w: 40, h: 190, depth: 5 },
                { x: 200, w: 60, h: 350, depth: 5 },
                { x: 270, w: 50, h: 240, depth: 5 },
                { x: 330, w: 55, h: 300, depth: 5 },
                { x: 10, w: 55, h: 180, depth: 4, hasSign: true, signText: 'NEO-TOKYO', signVertical: false },
                { x: 70, w: 48, h: 250, depth: 4 },
                { x: 130, w: 60, h: 200, depth: 4 },
                { x: 195, w: 45, h: 320, depth: 4, hasSign: true, signText: 'ãƒ©ãƒ¼ãƒ¡ãƒ³', signVertical: true },
                { x: 250, w: 55, h: 230, depth: 4 },
                { x: 315, w: 50, h: 270, depth: 4 },
                { x: 370, w: 40, h: 200, depth: 4 },
                { x: -10, w: 70, h: 160, depth: 3 },
                { x: 55, w: 65, h: 220, depth: 3, hasSign: true, signText: 'RAMEN', signVertical: false },
                { x: 125, w: 50, h: 180, depth: 3 },
                { x: 180, w: 70, h: 300, depth: 3, hasSign: true, signText: 'å…¨å›½èˆª', signVertical: true },
                { x: 260, w: 55, h: 240, depth: 3 },
                { x: 320, w: 65, h: 190, depth: 3, hasSign: true, signText: 'CYBER', signVertical: false },
                { x: 390, w: 50, h: 220, depth: 3 },
                { x: -20, w: 80, h: 140, depth: 2 },
                { x: 60, w: 75, h: 200, depth: 2, hasSign: true, signText: 'ãƒã‚ªæ±äº¬', signVertical: true },
                { x: 145, w: 60, h: 160, depth: 2 },
                { x: 210, w: 80, h: 280, depth: 2, hasSign: true, signText: 'CYBERNETICS', signVertical: false },
                { x: 300, w: 70, h: 210, depth: 2 },
                { x: 380, w: 60, h: 170, depth: 2 },
                { x: -40, w: 100, h: 120, depth: 1 },
                { x: 70, w: 90, h: 180, depth: 1, hasSign: true, signText: 'ã‚¤ãƒ¼ãƒ‘ãƒ‹ã‚¹', signVertical: true },
                { x: 170, w: 85, h: 150, depth: 1 },
                { x: 270, w: 95, h: 200, depth: 1, hasSign: true, signText: 'å…¨å›½èˆª', signVertical: true },
                { x: 375, w: 80, h: 140, depth: 1 },
            ]

            buildings.sort((a, b) => b.depth - a.depth)
            buildings.forEach(b => {
                ctx.globalAlpha = 0.4 + (1 - b.depth / 5) * 0.6
                drawBuilding3D(b)
            })
            ctx.globalAlpha = 1

            // === BRIDGES ===
            const bridges = [
                { y: GROUND_Y - 100 * scale, color: '#ff00ff' },
                { y: GROUND_Y - 180 * scale, color: '#00ffff' },
            ]
            bridges.forEach(br => {
                ctx.fillStyle = '#1a1a25'
                ctx.fillRect(0, br.y, W, 6 * scale)
                ctx.strokeStyle = br.color
                ctx.lineWidth = scale
                ctx.beginPath()
                ctx.moveTo(0, br.y)
                ctx.lineTo(W, br.y)
                ctx.stroke()

                ctx.fillStyle = '#0d0d15'
                for (let bx = 50 * scale; bx < W; bx += 150 * scale) {
                    ctx.fillRect(bx, br.y, 4 * scale, GROUND_Y - br.y)
                }
            })

            // === FLYING VEHICLES ===
            const drawFlyingCar = (x: number, y: number, dir: number, size: number) => {
                const w = 20 * size * scale
                const h = 6 * size * scale
                ctx.fillStyle = '#2a2a4a'
                ctx.fillRect(x, y, w * dir, h)
                ctx.fillStyle = '#ff4444'
                ctx.fillRect(x + (dir > 0 ? scale : w - 3 * scale), y + h / 2 - 2 * scale, 3 * scale, 4 * scale)
                ctx.fillStyle = '#ffffcc'
                ctx.shadowColor = '#ffffcc'
                ctx.shadowBlur = 4 * scale
                ctx.fillRect(x + (dir > 0 ? w - 4 * scale : scale), y + h / 2 - scale, 3 * scale, 2 * scale)
                ctx.shadowBlur = 0
            }

            drawFlyingCar((globalTime * 1.5) % (W + 60 * scale) - 30 * scale, 85 * scale, 1, 0.8)
            drawFlyingCar(W - (globalTime * 2) % (W + 60 * scale), 140 * scale, -1, 1)
            drawFlyingCar((globalTime * 1 + 150) % (W + 60 * scale) - 30 * scale, 200 * scale, 1, 1.2)
            drawFlyingCar(W - (globalTime * 0.8 + 80) % (W + 60 * scale), 260 * scale, -1, 0.7)

            // === BILLBOARD SCREENS ===
            ctx.fillStyle = '#101018'
            ctx.fillRect(20 * scale, GROUND_Y - 350 * scale, 70 * scale, 45 * scale)
            const leftScreenGrad = ctx.createLinearGradient(20 * scale, GROUND_Y - 350 * scale, 90 * scale, GROUND_Y - 305 * scale)
            const screenPulse = (Math.sin(globalTime * 0.08) + 1) / 2
            leftScreenGrad.addColorStop(0, `rgba(0, 200, 255, ${0.5 + screenPulse * 0.3})`)
            leftScreenGrad.addColorStop(1, `rgba(100, 0, 200, ${0.5 + screenPulse * 0.3})`)
            ctx.fillStyle = leftScreenGrad
            ctx.fillRect(22 * scale, GROUND_Y - 348 * scale, 66 * scale, 41 * scale)
            ctx.fillStyle = '#ffffff'
            ctx.font = `bold ${8 * scale}px monospace`
            ctx.fillText('SYSTEM', 28 * scale, GROUND_Y - 330 * scale)
            ctx.fillText('ONLINE', 28 * scale, GROUND_Y - 318 * scale)

            ctx.fillStyle = '#101018'
            ctx.fillRect(310 * scale, GROUND_Y - 280 * scale, 75 * scale, 50 * scale)
            const rightScreenGrad = ctx.createLinearGradient(310 * scale, GROUND_Y - 280 * scale, 385 * scale, GROUND_Y - 230 * scale)
            rightScreenGrad.addColorStop(0, `rgba(255, 100, 0, ${0.4 + screenPulse * 0.4})`)
            rightScreenGrad.addColorStop(1, `rgba(255, 0, 100, ${0.4 + screenPulse * 0.4})`)
            ctx.fillStyle = rightScreenGrad
            ctx.fillRect(312 * scale, GROUND_Y - 278 * scale, 71 * scale, 46 * scale)
            ctx.fillStyle = '#ffffff'
            ctx.font = `bold ${9 * scale}px monospace`
            ctx.fillText('NEURAL-NET', 318 * scale, GROUND_Y - 255 * scale)
            ctx.fillText('v3.7.2', 330 * scale, GROUND_Y - 242 * scale)

            // === GROUND ===
            ctx.fillStyle = '#080810'
            ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y)

            ctx.strokeStyle = '#00ffff'
            ctx.shadowColor = '#00ffff'
            ctx.shadowBlur = 6 * scale
            ctx.lineWidth = 2 * scale
            ctx.beginPath()
            ctx.moveTo(0, GROUND_Y)
            ctx.lineTo(W, GROUND_Y)
            ctx.stroke()
            ctx.shadowBlur = 0

            ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)'
            ctx.lineWidth = scale
            const gridOffset = (globalTime * 0.3) % (15 * scale)
            for (let gx = -15 * scale; gx < W + 15 * scale; gx += 15 * scale) {
                ctx.beginPath()
                ctx.moveTo(gx - gridOffset, GROUND_Y)
                ctx.lineTo(gx - gridOffset - 8 * scale, H)
                ctx.stroke()
            }

            // === BEACON LIGHTS ===
            const beaconPositions = [
                { x: 95 * scale, y: GROUND_Y - 340 * scale },
                { x: 230 * scale, y: GROUND_Y - 420 * scale },
                { x: 350 * scale, y: GROUND_Y - 310 * scale },
            ]

            beaconPositions.forEach((beacon, idx) => {
                const beaconAngle = (globalTime * 0.03 + idx * 2.1) % (Math.PI * 2)

                ctx.fillStyle = '#ff0000'
                ctx.shadowColor = '#ff0000'
                ctx.shadowBlur = 10 * scale
                ctx.beginPath()
                ctx.arc(beacon.x, beacon.y, 4 * scale, 0, Math.PI * 2)
                ctx.fill()
                ctx.shadowBlur = 0

                const beamLength = 150 * scale
                const beamWidth = 0.25

                const beamGrad = ctx.createRadialGradient(beacon.x, beacon.y, 0, beacon.x, beacon.y, beamLength)
                beamGrad.addColorStop(0, 'rgba(255, 50, 50, 0.4)')
                beamGrad.addColorStop(0.3, 'rgba(255, 30, 30, 0.2)')
                beamGrad.addColorStop(1, 'rgba(255, 0, 0, 0)')

                ctx.fillStyle = beamGrad
                ctx.beginPath()
                ctx.moveTo(beacon.x, beacon.y)
                ctx.lineTo(beacon.x + Math.cos(beaconAngle - beamWidth) * beamLength, beacon.y + Math.sin(beaconAngle - beamWidth) * beamLength)
                ctx.lineTo(beacon.x + Math.cos(beaconAngle + beamWidth) * beamLength, beacon.y + Math.sin(beaconAngle + beamWidth) * beamLength)
                ctx.closePath()
                ctx.fill()
            })

            // === FOREGROUND FOG ===
            const fgFogOffset = (globalTime * 0.4) % (W * 1.5)
            ctx.globalAlpha = 0.25

            for (let fx = -100 * scale; fx < W + 200 * scale; fx += 40 * scale) {
                const fogY = GROUND_Y - 30 * scale + Math.sin((fx + fgFogOffset) * 0.015) * 12 * scale
                const fogW = (70 + Math.sin(fx * 0.03 + globalTime * 0.01) * 25) * scale
                const fogH = (18 + Math.sin(fx * 0.02) * 6) * scale

                const fgFogGrad = ctx.createRadialGradient(fx - fgFogOffset + fogW / 2, fogY, 0, fx - fgFogOffset + fogW / 2, fogY, fogW / 1.5)
                fgFogGrad.addColorStop(0, 'rgba(80, 100, 120, 0.5)')
                fgFogGrad.addColorStop(0.4, 'rgba(60, 80, 100, 0.3)')
                fgFogGrad.addColorStop(1, 'rgba(40, 60, 80, 0)')

                ctx.fillStyle = fgFogGrad
                ctx.beginPath()
                ctx.ellipse(fx - fgFogOffset + fogW / 2, fogY, fogW, fogH, 0, 0, Math.PI * 2)
                ctx.fill()
            }

            const groundFogGrad = ctx.createLinearGradient(0, GROUND_Y - 50 * scale, 0, GROUND_Y + 10 * scale)
            groundFogGrad.addColorStop(0, 'rgba(60, 80, 100, 0)')
            groundFogGrad.addColorStop(0.5, 'rgba(70, 90, 110, 0.25)')
            groundFogGrad.addColorStop(1, 'rgba(80, 100, 120, 0.4)')
            ctx.fillStyle = groundFogGrad
            ctx.fillRect(0, GROUND_Y - 50 * scale, W, 60 * scale)

            ctx.globalAlpha = 1

            // Draw Bird
            if (powerUpActive.current) {
                ctx.shadowColor = '#00ff00'
                ctx.shadowBlur = 15 * scale
                ctx.fillStyle = '#88ff88'
            } else {
                ctx.fillStyle = '#fdb'
            }
            ctx.fillRect(scaledBirdX, birdY.current, scaledBirdSize, scaledBirdSize)
            ctx.shadowBlur = 0

            if (gameState === 'PLAYING') {
                if (powerUpActive.current && Date.now() > powerUpEndTime.current) {
                    powerUpActive.current = false
                }

                birdVelocity.current += scaledGravity
                birdY.current += birdVelocity.current

                // === PILL ===
                pillSpawnTimer.current++
                if (!pill.current && pillSpawnTimer.current > 500 && Math.random() < 0.02 && pipes.current.length > 0) {
                    const lastPipe = pipes.current[pipes.current.length - 1]
                    const gapCenter = lastPipe.topHeight + scaledPipeGap / 2
                    pill.current = { x: canvas.width + 20 * scale, y: gapCenter - 10 * scale, rotation: 0 }
                    pillSpawnTimer.current = 0
                }

                if (pill.current) {
                    pill.current.x -= scaledPipeSpeed * 0.8
                    pill.current.rotation += 0.1
                    pill.current.y += Math.sin(globalTime * 0.1) * 0.5 * scale

                    const px = pill.current.x
                    const py = pill.current.y
                    const rot = pill.current.rotation
                    const tabletRadius = 18 * scale
                    const tabletWidth = Math.abs(Math.cos(rot)) * tabletRadius + 4 * scale
                    const tabletHeight = tabletRadius

                    ctx.fillStyle = 'rgba(0, 80, 0, 0.4)'
                    ctx.beginPath()
                    ctx.ellipse(px + 4 * scale, py + tabletRadius + 8 * scale, tabletWidth * 0.7, 5 * scale, 0, 0, Math.PI * 2)
                    ctx.fill()

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

                    ctx.fillStyle = '#228822'
                    ctx.beginPath()
                    ctx.ellipse(px, py + 3 * scale, tabletWidth * 0.95, tabletHeight * 0.4, 0, 0, Math.PI)
                    ctx.fill()

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
                    ctx.beginPath()
                    ctx.ellipse(px, py - 2 * scale, tabletWidth * 0.4, tabletHeight * 0.35, 0, 0, Math.PI * 2)
                    ctx.fill()

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
                    ctx.beginPath()
                    ctx.ellipse(px - tabletWidth * 0.3, py - tabletHeight * 0.4, 4 * scale, 3 * scale, -0.5, 0, Math.PI * 2)
                    ctx.fill()

                    ctx.shadowColor = '#00ff00'
                    ctx.shadowBlur = 15 * scale
                    ctx.strokeStyle = '#44ff44'
                    ctx.lineWidth = 2 * scale
                    ctx.beginPath()
                    ctx.ellipse(px, py, tabletWidth + 4 * scale, tabletHeight + 4 * scale, 0, 0, Math.PI * 2)
                    ctx.stroke()
                    ctx.shadowBlur = 0

                    if (scaledBirdX < px + tabletWidth && scaledBirdX + scaledBirdSize > px - tabletWidth &&
                        birdY.current < py + tabletHeight && birdY.current + scaledBirdSize > py - tabletHeight) {
                        powerUpActive.current = true
                        powerUpEndTime.current = Date.now() + 5000
                        pill.current = null
                    }

                    if (pill.current && pill.current.x < -50 * scale) {
                        pill.current = null
                    }
                }

                // === PROJECTILES ===
                for (let i = projectiles.current.length - 1; i >= 0; i--) {
                    const proj = projectiles.current[i]
                    proj.x += 8 * scale

                    ctx.shadowColor = '#ffffff'
                    ctx.shadowBlur = 10 * scale
                    ctx.fillStyle = '#ffffff'
                    ctx.beginPath()
                    ctx.moveTo(proj.x + 12 * scale, proj.y)
                    ctx.quadraticCurveTo(proj.x, proj.y - 6 * scale, proj.x, proj.y)
                    ctx.quadraticCurveTo(proj.x, proj.y + 6 * scale, proj.x + 12 * scale, proj.y)
                    ctx.fill()
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
                    ctx.beginPath()
                    ctx.arc(proj.x + 4 * scale, proj.y, 3 * scale, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.shadowBlur = 0

                    for (let j = pipes.current.length - 1; j >= 0; j--) {
                        const p = pipes.current[j]
                        if (!p.destroyed && proj.x + 15 * scale > p.x && proj.x < p.x + scaledPipeWidth) {
                            if (proj.y < p.topHeight) {
                                p.destroyed = true
                                projectiles.current.splice(i, 1)
                                break
                            }
                            if (proj.y > p.topHeight + scaledPipeGap) {
                                p.destroyed = true
                                projectiles.current.splice(i, 1)
                                break
                            }
                        }
                    }

                    if (proj.x > canvas.width + 20 * scale) {
                        projectiles.current.splice(i, 1)
                    }
                }

                // === PIPES ===
                frameCount.current++
                if (frameCount.current % PIPE_SPAWN_RATE === 0) {
                    const minPipe = 50 * scale
                    const maxPipe = canvas.height - scaledPipeGap - 50 * scale - 20 * scale
                    const height = Math.floor(Math.random() * (maxPipe - minPipe + 1)) + minPipe
                    pipes.current.push({ x: canvas.width, topHeight: height, passed: false })
                }

                for (let i = pipes.current.length - 1; i >= 0; i--) {
                    const p = pipes.current[i]
                    p.x -= scaledPipeSpeed

                    if (!p.destroyed) {
                        ctx.fillStyle = '#73bf2e'
                        ctx.fillRect(p.x, 0, scaledPipeWidth, p.topHeight)
                        ctx.fillRect(p.x, p.topHeight + scaledPipeGap, scaledPipeWidth, canvas.height - (p.topHeight + scaledPipeGap) - 20 * scale)

                        if (scaledBirdX < p.x + scaledPipeWidth && scaledBirdX + scaledBirdSize > p.x &&
                            (birdY.current < p.topHeight || birdY.current + scaledBirdSize > p.topHeight + scaledPipeGap)) {
                            setGameState('GAME_OVER')
                        }
                    } else {
                        ctx.fillStyle = '#556633'
                        for (let d = 0; d < 5; d++) {
                            const dx = p.x + Math.sin(d * 1.5 + globalTime * 0.2) * 20 * scale
                            const dy = p.topHeight / 2 + Math.cos(d * 2 + globalTime * 0.3) * 30 * scale
                            ctx.fillRect(dx, dy, 8 * scale, 8 * scale)
                        }
                    }

                    if (p.x + scaledPipeWidth < scaledBirdX && !p.passed) {
                        setScore(prev => prev + 1)
                        p.passed = true
                    }

                    if (p.x < -60 * scale) {
                        pipes.current.splice(i, 1)
                    }
                }

                if (powerUpActive.current) {
                    const timeLeft = Math.ceil((powerUpEndTime.current - Date.now()) / 1000)
                    ctx.fillStyle = '#00ff00'
                    ctx.shadowColor = '#00ff00'
                    ctx.shadowBlur = 8 * scale
                    ctx.font = `bold ${16 * scale}px monospace`
                    ctx.fillText(`âš¡ POWER: ${timeLeft}s`, 10 * scale, 50 * scale)
                    ctx.font = `${12 * scale}px monospace`
                    ctx.fillText('(Jump to shoot!)', 10 * scale, 68 * scale)
                    ctx.shadowBlur = 0
                }

                // === ACID RAIN SYSTEM ===
                const timeSinceStart = Date.now() - gameStartTime.current
                const acidRainActive = timeSinceStart > ACID_RAIN_DELAY

                if (acidRainActive) {
                    // Spawn new rain drops (slight diagonal for speed effect)
                    if (Math.random() < 0.3) {
                        rainDrops.current.push({
                            x: Math.random() * (canvas.width + 50),  // Across the top
                            y: -10 - Math.random() * 30,
                            speed: (5 + Math.random() * 3) * scale,
                            length: (20 + Math.random() * 25) * scale,
                            vx: -(0.8 + Math.random() * 0.4) * scale  // Subtle leftward drift
                        })
                    }

                    // Update and draw rain drops
                    for (let i = rainDrops.current.length - 1; i >= 0; i--) {
                        const drop = rainDrops.current[i]
                        drop.y += drop.speed
                        drop.x += drop.vx  // Move diagonally

                        // Draw acid rain drop with glow (diagonal line)
                        ctx.strokeStyle = '#88ff00'
                        ctx.shadowColor = '#88ff00'
                        ctx.shadowBlur = 4 * scale
                        ctx.lineWidth = 2 * scale
                        ctx.beginPath()
                        ctx.moveTo(drop.x, drop.y)
                        ctx.lineTo(drop.x - drop.vx * 2, drop.y + drop.length)  // Angled line
                        ctx.stroke()
                        ctx.shadowBlur = 0

                        // Check collision with bird
                        if (drop.x > scaledBirdX && drop.x < scaledBirdX + scaledBirdSize &&
                            drop.y + drop.length > birdY.current && drop.y < birdY.current + scaledBirdSize) {
                            // Create splash particles!
                            for (let j = 0; j < 8; j++) {
                                const angle = (Math.PI / 4) + (Math.random() * Math.PI / 2)
                                const speed = (2 + Math.random() * 4) * scale
                                splashParticles.current.push({
                                    x: drop.x,
                                    y: birdY.current,
                                    vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
                                    vy: -Math.abs(Math.sin(angle) * speed),
                                    life: 30,
                                    color: Math.random() > 0.5 ? '#88ff00' : '#aaff44'
                                })
                            }
                            rainDrops.current.splice(i, 1)
                            continue
                        }

                        // Remove drops that are off screen (left edge or bottom)
                        if (drop.y > canvas.height || drop.x < -50) {
                            rainDrops.current.splice(i, 1)
                        }
                    }

                    // Update and draw splash particles
                    for (let i = splashParticles.current.length - 1; i >= 0; i--) {
                        const p = splashParticles.current[i]
                        p.x += p.vx
                        p.y += p.vy
                        p.vy += 0.2 * scale
                        p.life--

                        ctx.globalAlpha = p.life / 30
                        ctx.fillStyle = p.color
                        ctx.shadowColor = p.color
                        ctx.shadowBlur = 6 * scale
                        ctx.beginPath()
                        ctx.arc(p.x, p.y, 3 * scale, 0, Math.PI * 2)
                        ctx.fill()
                        ctx.shadowBlur = 0
                        ctx.globalAlpha = 1

                        if (p.life <= 0) {
                            splashParticles.current.splice(i, 1)
                        }
                    }

                    // Acid rain warning text
                    ctx.fillStyle = '#88ff00'
                    ctx.shadowColor = '#88ff00'
                    ctx.shadowBlur = 10 * scale
                    ctx.font = `bold ${12 * scale}px monospace`
                    ctx.fillText('ACID RAIN', canvas.width - 90 * scale, 30 * scale)
                    ctx.shadowBlur = 0
                }

                if (birdY.current + scaledBirdSize >= canvas.height - 20 * scale || birdY.current < 0) {
                    setGameState('GAME_OVER')
                }
            } else if (gameState === 'START') {
                ctx.fillStyle = 'white'
                ctx.font = `${30 * scale}px Arial`
                ctx.fillText('Click to Start', canvas.width / 2 - 80 * scale, canvas.height / 2)
                ctx.font = `${20 * scale}px Arial`
                ctx.fillText('or Press Space', canvas.width / 2 - 60 * scale, canvas.height / 2 + 30 * scale)
            } else if (gameState === 'PAUSED') {
                // Draw pipes in background
                pipes.current.forEach(p => {
                    if (!p.destroyed) {
                        ctx.fillStyle = '#73bf2e'
                        ctx.fillRect(p.x, 0, scaledPipeWidth, p.topHeight)
                        ctx.fillRect(p.x, p.topHeight + scaledPipeGap, scaledPipeWidth, canvas.height - (p.topHeight + scaledPipeGap) - 20 * scale)
                    }
                })

                // Pause overlay
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
                ctx.fillRect(0, 0, canvas.width, canvas.height)

                ctx.fillStyle = '#00ffff'
                ctx.shadowColor = '#00ffff'
                ctx.shadowBlur = 15 * scale
                ctx.font = `bold ${36 * scale}px Arial`
                ctx.fillText('PAUSED', canvas.width / 2 - 70 * scale, canvas.height / 2)
                ctx.shadowBlur = 0

                ctx.fillStyle = 'white'
                ctx.font = `${18 * scale}px Arial`
                ctx.fillText('Press ESC or ENTER to resume', canvas.width / 2 - 110 * scale, canvas.height / 2 + 40 * scale)
            } else if (gameState === 'GAME_OVER') {
                pipes.current.forEach(p => {
                    ctx.fillStyle = '#73bf2e'
                    ctx.fillRect(p.x, 0, scaledPipeWidth, p.topHeight)
                    ctx.fillRect(p.x, p.topHeight + scaledPipeGap, scaledPipeWidth, canvas.height - (p.topHeight + scaledPipeGap) - 20 * scale)
                })

                ctx.fillStyle = 'white'
                ctx.font = `${30 * scale}px Arial`
                ctx.fillText('Game Over', canvas.width / 2 - 70 * scale, canvas.height / 2)
                ctx.font = `${20 * scale}px Arial`
                ctx.fillText(`Score: ${score}`, canvas.width / 2 - 40 * scale, canvas.height / 2 + 40 * scale)
                ctx.fillText('Press Space to Restart', canvas.width / 2 - 90 * scale, canvas.height / 2 + 70 * scale)
            }

            animationFrameId.current = requestAnimationFrame(render)
        }

        render()

        return () => {
            cancelAnimationFrame(animationFrameId.current)
        }
    }, [gameState, score, canvasSize])

    return (
        <div
            ref={containerRef}
            onClick={jump}
            style={{
                width: '100vw',
                height: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                userSelect: 'none',
                outline: 'none',
                background: '#0a0a12',
                overflow: 'hidden'
            }}
        >
            <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                style={{
                    border: '2px solid #00ffff',
                    borderRadius: '8px',
                    boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)'
                }}
            />
            <div style={{ position: 'absolute', top: 20, color: '#00ffff', fontSize: `${28 * (canvasSize.height / 600)}px`, fontWeight: 'bold', textShadow: '0 0 10px #00ffff' }}>
                {score}
            </div>
            <button
                onClick={toggleMute}
                style={{
                    position: 'absolute',
                    top: 20,
                    right: 20,
                    background: 'rgba(0, 255, 255, 0.1)',
                    border: '2px solid #00ffff',
                    borderRadius: '50%',
                    width: 44,
                    height: 44,
                    cursor: 'pointer',
                    fontSize: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)',
                    transition: 'all 0.2s'
                }}
                title={isMuted ? 'Unmute' : 'Mute'}
            >
                {isMuted ? '🔇' : '🔊'}
            </button>
            <div style={{ position: 'absolute', bottom: 20, color: '#666', fontSize: '14px' }}>
                Space or Click to Jump â€¢ Collect green pill for power-up!
            </div>
            <audio
                ref={audioRef}
                src="/background.mp3"
                loop
                preload="auto"
            />
        </div>
    )
}

export default GameEngine

