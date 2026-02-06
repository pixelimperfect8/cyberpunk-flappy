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
    const birdRotation = useRef(0) // For rotation animation
    const pipes = useRef<{ x: number, topHeight: number, passed: boolean, destroyed?: boolean, towerIndex?: number }[]>([])
    const frameCount = useRef(0)
    const animationFrameId = useRef<number>(0)
    const dickySprite = useRef<HTMLImageElement | null>(null)
    const dickyBigSprite = useRef<HTMLImageElement | null>(null) // Blue pill transformation sprite
    const dickyAlt1 = useRef<HTMLImageElement | null>(null) // Alternate sprite 1
    const dickyAlt2 = useRef<HTMLImageElement | null>(null) // Alternate sprite 2
    const currentAltSprite = useRef<number>(0) // 0 = normal, 1 = alt1, 2 = alt2
    const altSpriteSwapTimer = useRef<number>(0) // Timer for next swap check

    // Parallax skyline backgrounds
    const skylineBack = useRef<HTMLImageElement | null>(null)
    const skylineFront = useRef<HTMLImageElement | null>(null)
    const skylineBackX = useRef(0)
    const skylineFrontX = useRef(0)

    // Tower/Obstacle sprites - separate arrays for top and bottom
    const TOP_TOWER_PATHS = ['/tower1.png', '/tower4.png', '/tower5.png', '/tower6.png']
    const BOTTOM_TOWER_PATHS = ['/tower2.png', '/tower7.png', '/tower8.png']
    const topTowerSprites = useRef<(HTMLImageElement | null)[]>(new Array(TOP_TOWER_PATHS.length).fill(null))
    const bottomTowerSprites = useRef<(HTMLImageElement | null)[]>(new Array(BOTTOM_TOWER_PATHS.length).fill(null))

    // Railcart animation system
    const railcartSprite = useRef<HTMLImageElement | null>(null)
    const railcart = useRef<{ x: number, speed: number } | null>(null)
    const railcartSpawnTimer = useRef(0)
    const RAIL_Y_PERCENT = 0.35 // Rail position (35% from top)

    // Power-up system (green pill - good)
    const powerUpActive = useRef(false)
    const powerUpEndTime = useRef(0)
    const pill = useRef<{ x: number, y: number, rotation: number } | null>(null)
    const pillSpawnTimer = useRef(0)
    const projectiles = useRef<{ x: number, y: number }[]>([])

    // Blue pill system (debuff - makes bird bigger, game faster)
    const bluePillActive = useRef(false)
    const bluePillEndTime = useRef(0)
    const bluePill = useRef<{ x: number, y: number, rotation: number } | null>(null)
    const bluePillSpawnTimer = useRef(0)
    const BLUE_PILL_DURATION = 5000 // 5 seconds
    const BLUE_PILL_SIZE_MULT = 1.5 // 50% bigger
    const BLUE_PILL_SPEED_MULT = 1.4 // 40% faster

    // Acid rain system
    const gameStartTime = useRef(0)
    const rainDrops = useRef<{ x: number, y: number, speed: number, length: number, vx: number }[]>([])
    const splashParticles = useRef<{ x: number, y: number, vx: number, vy: number, life: number, color: string }[]>([])
    const explosionParticles = useRef<{ x: number, y: number, vx: number, vy: number, life: number, size: number, color: string }[]>([])
    const ACID_RAIN_DELAY = 15000 // 15 seconds before acid rain starts

    // Villain taunt system - multiple portraits!
    const villainSprites = useRef<HTMLImageElement[]>([])
    const currentVillainIndex = useRef(0)
    const currentTaunt = useRef<string | null>(null)
    const tauntEndTime = useRef(0)
    const lastTauntScore = useRef(0)
    const VILLAIN_PATHS = ['/villain.jpg', '/villain2.jpg', '/villain3.jpg', '/villain4.jpg']
    const TAUNT_MESSAGES = [
        "There's no place to hide, Dicky!",
        "You're dead, Dicky!",
        "I'm coming for you!",
        "Give up now, Dicky!",
        "You can't escape me!",
        "Nice try, little Dicky!",
        "Running won't save you!",
        "I see you, Dicky!",
        "Your time is up!",
        "Keep flying... it won't help!",
        "Nowhere to run, Dicky!",
        "This ends now!"
    ]

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

    // Sound effect functions using Web Audio API
    const playPillSound = useCallback(() => {
        if (isMuted) return
        try {
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.setValueAtTime(400, ctx.currentTime)
            osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1)
            osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15)
            gain.gain.setValueAtTime(0.3, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
            osc.start(ctx.currentTime)
            osc.stop(ctx.currentTime + 0.2)
        } catch (e) {
            console.log('Could not play pill sound', e)
        }
    }, [isMuted])

    const playExplosionSound = useCallback(() => {
        if (isMuted) return
        try {
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
            // White noise burst for explosion
            const bufferSize = ctx.sampleRate * 0.2
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
            const data = buffer.getChannelData(0)
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2)
            }
            const noise = ctx.createBufferSource()
            noise.buffer = buffer
            const gain = ctx.createGain()
            const filter = ctx.createBiquadFilter()
            filter.type = 'lowpass'
            filter.frequency.setValueAtTime(1000, ctx.currentTime)
            filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.15)
            noise.connect(filter)
            filter.connect(gain)
            gain.connect(ctx.destination)
            gain.gain.setValueAtTime(0.5, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
            noise.start(ctx.currentTime)
        } catch (e) {
            console.log('Could not play explosion sound', e)
        }
    }, [isMuted])

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

    // Load the Dicky sprite
    useEffect(() => {
        const img = new Image()
        img.src = '/dicky.png'
        img.onload = () => {
            dickySprite.current = img
        }
        // Load big dicky sprite for blue pill transformation
        const bigImg = new Image()
        bigImg.src = '/dicky_big.png'
        bigImg.onload = () => {
            console.log('Big Dicky sprite loaded')
            dickyBigSprite.current = bigImg
        }
        // Load alternate sprites for random swapping
        const alt1Img = new Image()
        alt1Img.src = '/dicky_alt1.png'
        alt1Img.onload = () => { dickyAlt1.current = alt1Img }
        const alt2Img = new Image()
        alt2Img.src = '/dicky_alt2.png'
        alt2Img.onload = () => { dickyAlt2.current = alt2Img }
        // Load all villain sprites
        VILLAIN_PATHS.forEach((path, index) => {
            const villainImg = new Image()
            villainImg.crossOrigin = 'anonymous'
            villainImg.onload = () => {
                console.log(`Villain ${index + 1} loaded: ${path}`)
                villainSprites.current[index] = villainImg
            }
            villainImg.onerror = (e) => {
                console.error(`Failed to load villain ${index + 1}:`, path, e)
            }
            villainImg.src = path
        })
        // Load parallax skyline backgrounds
        const skyBack = new Image()
        skyBack.src = '/skyline_back.png'
        skyBack.onload = () => skylineBack.current = skyBack
        const skyFront = new Image()
        skyFront.src = '/skyline_front.png'
        skyFront.onload = () => skylineFront.current = skyFront
        // Load tower/obstacle sprites - separate top and bottom
        TOP_TOWER_PATHS.forEach((path, index) => {
            const towerImg = new Image()
            towerImg.src = path
            towerImg.onload = () => { topTowerSprites.current[index] = towerImg }
        })
        BOTTOM_TOWER_PATHS.forEach((path, index) => {
            const towerImg = new Image()
            towerImg.src = path
            towerImg.onload = () => { bottomTowerSprites.current[index] = towerImg }
        })
        // Load railcart sprite
        const railcartImg = new Image()
        railcartImg.src = '/railcart.png'
        railcartImg.onload = () => { railcartSprite.current = railcartImg }
    }, [])

    const resetGame = () => {
        const scale = getScale()
        birdY.current = 300 * scale
        birdVelocity.current = 0
        birdRotation.current = 0
        // Reset taunt system
        currentTaunt.current = null
        tauntEndTime.current = 0
        lastTauntScore.current = 0
        pipes.current = []
        frameCount.current = 0
        powerUpActive.current = false
        powerUpEndTime.current = 0
        pill.current = null
        pillSpawnTimer.current = 0
        projectiles.current = []
        // Reset blue pill
        bluePillActive.current = false
        bluePillEndTime.current = 0
        bluePill.current = null
        bluePillSpawnTimer.current = 0
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
            const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
            const mobileSpeedMult = isMobile ? 1.3 : 1
            birdVelocity.current = LIFT * scale * mobileSpeedMult
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
        // Mobile speed boost - detect touch devices
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
        const mobileSpeedMult = isMobile ? 1.3 : 1
        const scaledGravity = GRAVITY * scale * mobileSpeedMult
        // Dynamic values based on blue pill status
        const bluePillMult = bluePillActive.current ? BLUE_PILL_SPEED_MULT : 1
        const scaledPipeSpeed = PIPE_SPEED * scale * bluePillMult * mobileSpeedMult
        const scaledPipeGap = PIPE_GAP * scale
        const birdSizeMult = bluePillActive.current ? BLUE_PILL_SIZE_MULT : 1
        const scaledBirdSize = 30 * scale * birdSizeMult
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

            // --- SKY GRADIENT (Animated - dynamic color shift) ---
            const timeShift = Math.sin(globalTime * 0.01) * 0.1
            const skyGrad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y + 150 * scale)
            skyGrad.addColorStop(0, '#0d0d1a')
            skyGrad.addColorStop(0.15, `hsl(${240 + Math.sin(globalTime * 0.008) * 10}, 30%, ${8 + timeShift * 3}%)`)
            skyGrad.addColorStop(0.4, `hsl(${210 + Math.sin(globalTime * 0.006) * 15}, 25%, ${18 + timeShift * 5}%)`)
            skyGrad.addColorStop(0.7, `hsl(${200 + Math.sin(globalTime * 0.004) * 20}, 20%, ${28 + timeShift * 4}%)`)
            skyGrad.addColorStop(1, `hsl(${190 + Math.sin(globalTime * 0.003) * 25}, 15%, ${35 + timeShift * 3}%)`)
            ctx.fillStyle = skyGrad
            ctx.fillRect(0, 0, W, H)

            // --- PULSING NEON HORIZON GLOW ---
            const neonPulse1 = (Math.sin(globalTime * 0.04) + 1) / 2 // 0-1 pulse
            const neonPulse2 = (Math.sin(globalTime * 0.03 + 1) + 1) / 2
            const neonPulse3 = (Math.sin(globalTime * 0.025 + 2) + 1) / 2

            // Magenta glow
            const magentaGlow = ctx.createRadialGradient(
                W * 0.3, HORIZON_Y + 30 * scale, 0,
                W * 0.3, HORIZON_Y + 30 * scale, 200 * scale
            )
            magentaGlow.addColorStop(0, `rgba(255, 0, 150, ${0.15 + neonPulse1 * 0.15})`)
            magentaGlow.addColorStop(0.5, `rgba(255, 0, 100, ${0.08 + neonPulse1 * 0.08})`)
            magentaGlow.addColorStop(1, 'rgba(255, 0, 80, 0)')
            ctx.fillStyle = magentaGlow
            ctx.fillRect(0, 0, W, H)

            // Cyan glow
            const cyanGlow = ctx.createRadialGradient(
                W * 0.7, HORIZON_Y + 20 * scale, 0,
                W * 0.7, HORIZON_Y + 20 * scale, 180 * scale
            )
            cyanGlow.addColorStop(0, `rgba(0, 255, 255, ${0.12 + neonPulse2 * 0.12})`)
            cyanGlow.addColorStop(0.5, `rgba(0, 200, 255, ${0.06 + neonPulse2 * 0.06})`)
            cyanGlow.addColorStop(1, 'rgba(0, 150, 255, 0)')
            ctx.fillStyle = cyanGlow
            ctx.fillRect(0, 0, W, H)

            // Purple center glow
            const purpleGlow = ctx.createRadialGradient(
                W * 0.5, HORIZON_Y, 0,
                W * 0.5, HORIZON_Y, 250 * scale
            )
            purpleGlow.addColorStop(0, `rgba(150, 50, 255, ${0.1 + neonPulse3 * 0.1})`)
            purpleGlow.addColorStop(0.6, `rgba(100, 0, 200, ${0.05 + neonPulse3 * 0.05})`)
            purpleGlow.addColorStop(1, 'rgba(50, 0, 100, 0)')
            ctx.fillStyle = purpleGlow
            ctx.fillRect(0, 0, W, H)

            // --- SWEEPING LIGHT BEAMS ---
            ctx.globalAlpha = 0.03
            for (let beam = 0; beam < 3; beam++) {
                const beamAngle = (globalTime * 0.02 + beam * 2) % (Math.PI * 2)
                const beamX = W * 0.5 + Math.cos(beamAngle) * W * 0.4
                const beamGrad = ctx.createLinearGradient(beamX, 0, beamX + 100 * scale, HORIZON_Y)
                beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0)')
                beamGrad.addColorStop(0.5, `rgba(${beam === 0 ? '255,100,255' : beam === 1 ? '100,255,255' : '255,255,100'}, 1)`)
                beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
                ctx.fillStyle = beamGrad
                ctx.beginPath()
                ctx.moveTo(beamX - 30 * scale, 0)
                ctx.lineTo(beamX + 30 * scale, 0)
                ctx.lineTo(beamX + 80 * scale, HORIZON_Y)
                ctx.lineTo(beamX - 80 * scale, HORIZON_Y)
                ctx.closePath()
                ctx.fill()
            }
            ctx.globalAlpha = 1

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



            // === PARALLAX SKYLINE BACKGROUNDS ===
            const skyScrollSpeed = scaledPipeSpeed * 0.3

            // Draw back skyline (slower, distant)
            if (skylineBack.current) {
                skylineBackX.current -= skyScrollSpeed * 0.3
                const backImg = skylineBack.current
                const backH = GROUND_Y - HORIZON_Y + 50 * scale
                const backW = backImg.width * (backH / backImg.height)
                if (skylineBackX.current <= -backW) skylineBackX.current = 0
                ctx.globalAlpha = 0.7
                ctx.drawImage(backImg, skylineBackX.current, HORIZON_Y - 50 * scale, backW, backH)
                ctx.drawImage(backImg, skylineBackX.current + backW, HORIZON_Y - 50 * scale, backW, backH)
                ctx.globalAlpha = 1
            }

            // Draw front skyline (faster, closer)
            if (skylineFront.current) {
                skylineFrontX.current -= skyScrollSpeed * 0.6
                const frontImg = skylineFront.current
                const frontH = GROUND_Y - HORIZON_Y + 80 * scale
                const frontW = frontImg.width * (frontH / frontImg.height)
                if (skylineFrontX.current <= -frontW) skylineFrontX.current = 0
                ctx.drawImage(frontImg, skylineFrontX.current, HORIZON_Y - 80 * scale, frontW, frontH)
                ctx.drawImage(frontImg, skylineFrontX.current + frontW, HORIZON_Y - 80 * scale, frontW, frontH)
            }


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

            // === RAILCART ANIMATION (runs on top teal bridge line) ===
            const TOP_RAIL_Y = GROUND_Y - 180 * scale // Top teal bridge position
            if (gameState === 'PLAYING') {
                railcartSpawnTimer.current++
                // Random spawn every ~3-6 seconds (180-360 frames at 60fps)
                if (!railcart.current && railcartSpawnTimer.current > 180 && Math.random() < 0.02) {
                    railcart.current = { x: -150, speed: 4 + Math.random() * 3 }
                    railcartSpawnTimer.current = 0
                }
            }

            if (railcart.current && railcartSprite.current) {
                railcart.current.x += railcart.current.speed
                const cartW = 80 * scale
                const cartH = cartW * (railcartSprite.current.height / railcartSprite.current.width)
                const cartY = TOP_RAIL_Y - cartH

                // Teal glow underneath the railcart
                ctx.shadowColor = '#00ffff'
                ctx.shadowBlur = 20 * scale
                ctx.fillStyle = '#00ffff'
                ctx.fillRect(railcart.current.x + 5 * scale, TOP_RAIL_Y - 3 * scale, cartW - 10 * scale, 6 * scale)
                ctx.shadowBlur = 0

                // Draw the railcart
                ctx.drawImage(railcartSprite.current, railcart.current.x, cartY, cartW, cartH)

                // Remove when off screen
                if (railcart.current.x > W + 100 * scale) {
                    railcart.current = null
                }
            }

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

            // Draw Bird (Flappy Dicky sprite with rotation)
            ctx.save()

            // Calculate center of bird for rotation
            const birdCenterX = scaledBirdX + scaledBirdSize / 2
            const birdCenterY = birdY.current + scaledBirdSize / 2

            // Update rotation based on velocity when power-up is active
            if (powerUpActive.current) {
                // Spin forward as it falls/jumps
                birdRotation.current += 0.15
            } else {
                // Normal mode: slight tilt based on velocity
                const targetRotation = birdVelocity.current * 0.05
                birdRotation.current = birdRotation.current * 0.9 + targetRotation * 0.1
            }

            ctx.translate(birdCenterX, birdCenterY)
            ctx.rotate(birdRotation.current)

            // Apply glow effects
            if (bluePillActive.current) {
                ctx.shadowColor = '#0088ff'
                ctx.shadowBlur = 20 * scale
            } else if (powerUpActive.current) {
                ctx.shadowColor = '#00ff00'
                ctx.shadowBlur = 20 * scale
            }

            // Draw the sprite or fallback to colored square
            if (bluePillActive.current && dickyBigSprite.current) {
                // Blue pill transformation - use big dicky sprite!
                const spriteW = scaledBirdSize * 3.5  // Even bigger for transformation
                const spriteH = scaledBirdSize * 2.5
                ctx.drawImage(dickyBigSprite.current, -spriteW / 2, -spriteH / 2, spriteW, spriteH)
            } else {
                // Random sprite swap logic (only when not blue pill)
                altSpriteSwapTimer.current++
                if (altSpriteSwapTimer.current > 600) { // Check every ~10 seconds
                    altSpriteSwapTimer.current = 0
                    if (Math.random() < 0.1) { // 10% chance to swap
                        // Pick a random alt sprite (1 or 2), or go back to normal (0)
                        currentAltSprite.current = Math.floor(Math.random() * 3)
                    }
                }
                // Also revert to normal after ~5 seconds of alt sprite
                if (currentAltSprite.current !== 0 && altSpriteSwapTimer.current > 300) {
                    currentAltSprite.current = 0
                }

                // Select sprite based on current alt state
                let activeSprite = dickySprite.current
                if (currentAltSprite.current === 1 && dickyAlt1.current) {
                    activeSprite = dickyAlt1.current
                } else if (currentAltSprite.current === 2 && dickyAlt2.current) {
                    activeSprite = dickyAlt2.current
                }

                if (activeSprite) {
                    // Normal sprite
                    const spriteW = scaledBirdSize * 2.5  // Wider for the horizontal sprite
                    const spriteH = scaledBirdSize * 1.5
                    ctx.drawImage(activeSprite, -spriteW / 2, -spriteH / 2, spriteW, spriteH)
                } else {
                    // Fallback colored square
                    if (bluePillActive.current) {
                        ctx.fillStyle = '#8888ff'
                    } else if (powerUpActive.current) {
                        ctx.fillStyle = '#88ff88'
                    } else {
                        ctx.fillStyle = '#fdb'
                    }
                    ctx.fillRect(-scaledBirdSize / 2, -scaledBirdSize / 2, scaledBirdSize, scaledBirdSize)
                }
            }

            ctx.restore()
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
                        playPillSound() // Play sound on pill collect
                    }

                    if (pill.current && pill.current.x < -50 * scale) {
                        pill.current = null
                    }
                }

                // === BLUE PILL (DEBUFF) ===
                bluePillSpawnTimer.current++
                if (!bluePill.current && bluePillSpawnTimer.current > 800 && Math.random() < 0.008 && pipes.current.length > 0) {
                    const lastPipe = pipes.current[pipes.current.length - 1]
                    const gapCenter = lastPipe.topHeight + scaledPipeGap / 2
                    bluePill.current = { x: canvas.width + 40 * scale, y: gapCenter + 20 * scale, rotation: 0 }
                    bluePillSpawnTimer.current = 0
                }

                if (bluePill.current) {
                    bluePill.current.x -= scaledPipeSpeed * 0.8
                    bluePill.current.rotation += 0.12
                    bluePill.current.y += Math.sin(globalTime * 0.12) * 0.6 * scale

                    const bpx = bluePill.current.x
                    const bpy = bluePill.current.y
                    const bpRot = bluePill.current.rotation
                    const bpRadius = 18 * scale
                    const bpWidth = Math.abs(Math.cos(bpRot)) * bpRadius + 4 * scale
                    const bpHeight = bpRadius

                    // Shadow
                    ctx.fillStyle = 'rgba(0, 0, 80, 0.4)'
                    ctx.beginPath()
                    ctx.ellipse(bpx + 4 * scale, bpy + bpRadius + 8 * scale, bpWidth * 0.7, 5 * scale, 0, 0, Math.PI * 2)
                    ctx.fill()

                    // Blue pill gradient
                    const bpGrad = ctx.createLinearGradient(bpx - bpWidth, bpy, bpx + bpWidth, bpy)
                    bpGrad.addColorStop(0, '#1a1a6b')
                    bpGrad.addColorStop(0.3, '#3333cc')
                    bpGrad.addColorStop(0.5, '#5555ee')
                    bpGrad.addColorStop(0.7, '#3333cc')
                    bpGrad.addColorStop(1, '#1a1a6b')

                    ctx.fillStyle = bpGrad
                    ctx.beginPath()
                    ctx.ellipse(bpx, bpy, bpWidth, bpHeight, 0, 0, Math.PI * 2)
                    ctx.fill()

                    // Blue glow
                    ctx.shadowColor = '#0088ff'
                    ctx.shadowBlur = 15 * scale
                    ctx.strokeStyle = '#4488ff'
                    ctx.lineWidth = 2 * scale
                    ctx.beginPath()
                    ctx.ellipse(bpx, bpy, bpWidth + 4 * scale, bpHeight + 4 * scale, 0, 0, Math.PI * 2)
                    ctx.stroke()
                    ctx.shadowBlur = 0

                    // Collision detection
                    if (scaledBirdX < bpx + bpWidth && scaledBirdX + scaledBirdSize > bpx - bpWidth &&
                        birdY.current < bpy + bpHeight && birdY.current + scaledBirdSize > bpy - bpHeight) {
                        bluePillActive.current = true
                        bluePillEndTime.current = Date.now() + BLUE_PILL_DURATION
                        bluePill.current = null
                        playPillSound() // Play sound on pill collect
                    }

                    if (bluePill.current && bluePill.current.x < -50 * scale) {
                        bluePill.current = null
                    }
                }

                // Check blue pill expiry
                if (bluePillActive.current && Date.now() > bluePillEndTime.current) {
                    bluePillActive.current = false
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
                                // Spawn explosion particles!
                                for (let k = 0; k < 15; k++) {
                                    const angle = Math.random() * Math.PI * 2
                                    const speed = (3 + Math.random() * 5) * scale
                                    explosionParticles.current.push({
                                        x: proj.x,
                                        y: proj.y,
                                        vx: Math.cos(angle) * speed,
                                        vy: Math.sin(angle) * speed,
                                        life: 1,
                                        size: (5 + Math.random() * 8) * scale,
                                        color: Math.random() > 0.5 ? '#ff8800' : '#ffcc00'
                                    })
                                }
                                playExplosionSound()
                                break
                            }
                            if (proj.y > p.topHeight + scaledPipeGap) {
                                p.destroyed = true
                                projectiles.current.splice(i, 1)
                                // Spawn explosion particles!
                                for (let k = 0; k < 15; k++) {
                                    const angle = Math.random() * Math.PI * 2
                                    const speed = (3 + Math.random() * 5) * scale
                                    explosionParticles.current.push({
                                        x: proj.x,
                                        y: proj.y,
                                        vx: Math.cos(angle) * speed,
                                        vy: Math.sin(angle) * speed,
                                        life: 1,
                                        size: (5 + Math.random() * 8) * scale,
                                        color: Math.random() > 0.5 ? '#ff8800' : '#ffcc00'
                                    })
                                }
                                playExplosionSound()
                                break
                            }
                        }
                    }

                    if (proj.x > canvas.width + 20 * scale) {
                        projectiles.current.splice(i, 1)
                    }
                }

                // === EXPLOSION PARTICLES ===
                for (let i = explosionParticles.current.length - 1; i >= 0; i--) {
                    const p = explosionParticles.current[i]
                    p.x += p.vx
                    p.y += p.vy
                    p.vy += 0.2 * scale // Gravity
                    p.life -= 0.03

                    if (p.life <= 0) {
                        explosionParticles.current.splice(i, 1)
                    } else {
                        ctx.globalAlpha = p.life
                        ctx.shadowColor = p.color
                        ctx.shadowBlur = 10 * scale
                        ctx.fillStyle = p.color
                        ctx.beginPath()
                        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
                        ctx.fill()
                        ctx.shadowBlur = 0
                        ctx.globalAlpha = 1
                    }
                }

                // === PIPES ===
                frameCount.current++
                if (frameCount.current % PIPE_SPAWN_RATE === 0) {
                    const minPipe = 50 * scale
                    const maxPipe = canvas.height - scaledPipeGap - 50 * scale - 20 * scale
                    const height = Math.floor(Math.random() * (maxPipe - minPipe + 1)) + minPipe
                    const towerIdx = Math.floor(Math.random() * Math.max(TOP_TOWER_PATHS.length, BOTTOM_TOWER_PATHS.length))
                    pipes.current.push({ x: canvas.width, topHeight: height, passed: false, towerIndex: towerIdx })
                }

                for (let i = pipes.current.length - 1; i >= 0; i--) {
                    const p = pipes.current[i]
                    p.x -= scaledPipeSpeed

                    if (!p.destroyed) {
                        const pipeSeed = p.x * 7.89

                        // Draw cyberpunk building segment as obstacle
                        const drawObstacleSegment = (ox: number, oy: number, ow: number, oh: number, isTop: boolean, towerIdx: number = 0) => {
                            // Use tower sprite if available - select from appropriate array
                            const spriteArray = isTop ? topTowerSprites.current : bottomTowerSprites.current
                            const maxIdx = isTop ? TOP_TOWER_PATHS.length : BOTTOM_TOWER_PATHS.length
                            const towerSprite = spriteArray[towerIdx % maxIdx]
                            if (towerSprite) {
                                ctx.save()
                                ctx.beginPath()
                                ctx.rect(ox - ow * 0.4, oy, ow * 1.8, oh)
                                ctx.clip()

                                const spriteAspect = towerSprite.width / towerSprite.height
                                // Scale to fill obstacle area - use whichever is larger to ensure no gaps
                                const widthBasedH = (ow * 1.8) / spriteAspect
                                const targetH = Math.max(widthBasedH, oh)
                                const targetW = targetH * spriteAspect

                                if (isTop) {
                                    // Top obstacle: flip vertically, align bottom of sprite to bottom of obstacle area
                                    ctx.translate(ox - ow * 0.4 + targetW / 2, oy + oh)
                                    ctx.scale(1, -1) // Flip vertically
                                    ctx.drawImage(towerSprite, -targetW / 2, 0, targetW, targetH)
                                } else {
                                    // Bottom obstacle: draw normally, align top of sprite to top of obstacle area
                                    ctx.drawImage(towerSprite, ox - ow * 0.4, oy, targetW, targetH)
                                }
                                ctx.restore()
                                return
                            }
                            // Base building gradient
                            const obsGrad = ctx.createLinearGradient(ox, oy, ox + ow, oy)
                            obsGrad.addColorStop(0, '#2a2a35')
                            obsGrad.addColorStop(0.5, '#353540')
                            obsGrad.addColorStop(1, '#252530')
                            ctx.fillStyle = obsGrad
                            ctx.fillRect(ox, oy, ow, oh)

                            // Rust spots
                            for (let r = 0; r < 4; r++) {
                                const rx = ox + seededRand(pipeSeed + r) * ow * 0.8
                                const ry = oy + seededRand(pipeSeed + r * 2) * oh * 0.8
                                const rSize = (2 + seededRand(pipeSeed + r * 3) * 3) * scale
                                ctx.fillStyle = `rgba(90, 50, 30, 0.4)`
                                ctx.beginPath()
                                ctx.arc(rx, ry, rSize, 0, Math.PI * 2)
                                ctx.fill()
                            }

                            // Metal panel lines
                            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
                            ctx.lineWidth = 1 * scale
                            for (let py = oy + 20 * scale; py < oy + oh - 10 * scale; py += 30 * scale) {
                                ctx.beginPath()
                                ctx.moveTo(ox + 3 * scale, py)
                                ctx.lineTo(ox + ow - 3 * scale, py)
                                ctx.stroke()
                            }

                            // Exposed pipe on side
                            const pipeX = ox + 3 * scale
                            ctx.fillStyle = '#3a3a42'
                            ctx.fillRect(pipeX, oy + 10 * scale, 4 * scale, oh - 20 * scale)
                            ctx.fillStyle = '#484850'
                            ctx.fillRect(pipeX + 1 * scale, oy + 10 * scale, 2 * scale, oh - 20 * scale)
                            // Pipe joints
                            for (let jy = oy + 25 * scale; jy < oy + oh - 15 * scale; jy += 40 * scale) {
                                ctx.fillStyle = '#2a2a32'
                                ctx.fillRect(pipeX - 1 * scale, jy, 6 * scale, 5 * scale)
                            }

                            // AC unit
                            if (oh > 60 * scale) {
                                const acX = ox + ow - 18 * scale
                                const acY = oy + (isTop ? oh - 25 * scale : 15 * scale)
                                ctx.fillStyle = '#444'
                                ctx.fillRect(acX, acY, 12 * scale, 10 * scale)
                                ctx.strokeStyle = '#333'
                                ctx.lineWidth = 0.5 * scale
                                for (let vl = 0; vl < 4; vl++) {
                                    ctx.beginPath()
                                    ctx.moveTo(acX + 2 * scale, acY + 2 * scale + vl * 2 * scale)
                                    ctx.lineTo(acX + 10 * scale, acY + 2 * scale + vl * 2 * scale)
                                    ctx.stroke()
                                }
                            }

                            // Windows with neon glow
                            const winColors = ['#00ffff', '#ff00ff', '#ffaa00', '#ff6644']
                            for (let wy = oy + 15 * scale; wy < oy + oh - 15 * scale; wy += 12 * scale) {
                                for (let wx = ox + 12 * scale; wx < ox + ow - 12 * scale; wx += 10 * scale) {
                                    if (seededRand(wx * wy * 0.001 + pipeSeed) > 0.4) {
                                        const colorIdx = Math.floor(seededRand(wx + wy + pipeSeed) * winColors.length)
                                        ctx.fillStyle = winColors[colorIdx]
                                        ctx.globalAlpha = 0.5 + seededRand(wx * wy) * 0.5
                                        ctx.fillRect(wx, wy, 4 * scale, 5 * scale)
                                    }
                                }
                            }
                            ctx.globalAlpha = 1

                            // Danger edge glow (at gap edge)
                            const edgeY = isTop ? oy + oh : oy
                            ctx.shadowColor = '#ff4400'
                            ctx.shadowBlur = 8 * scale
                            ctx.fillStyle = '#ff4400'
                            ctx.fillRect(ox, edgeY - (isTop ? 3 * scale : 0), ow, 3 * scale)
                            ctx.shadowBlur = 0
                        }

                        // Draw top obstacle
                        drawObstacleSegment(p.x, 0, scaledPipeWidth, p.topHeight, true, p.towerIndex || 0)
                        // Draw bottom obstacle  
                        const bottomY = p.topHeight + scaledPipeGap
                        const bottomH = canvas.height - bottomY - 20 * scale
                        drawObstacleSegment(p.x, bottomY, scaledPipeWidth, bottomH, false, p.towerIndex || 0)

                        if (scaledBirdX < p.x + scaledPipeWidth && scaledBirdX + scaledBirdSize > p.x &&
                            (birdY.current < p.topHeight || birdY.current + scaledBirdSize > p.topHeight + scaledPipeGap)) {
                            setGameState('GAME_OVER')
                        }
                    } else {
                        // Destroyed debris - floating pieces
                        ctx.fillStyle = '#3a3a45'
                        for (let d = 0; d < 6; d++) {
                            const dx = p.x + Math.sin(d * 1.5 + globalTime * 0.15) * 25 * scale
                            const dy = p.topHeight / 2 + Math.cos(d * 2 + globalTime * 0.2) * 40 * scale + d * 10 * scale
                            const dSize = (6 + d * 2) * scale
                            ctx.fillRect(dx, dy, dSize, dSize)
                            // Metal shine
                            ctx.fillStyle = '#505058'
                            ctx.fillRect(dx + 1 * scale, dy + 1 * scale, dSize * 0.4, dSize * 0.3)
                            ctx.fillStyle = '#3a3a45'
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

                // === VILLAIN TAUNT SYSTEM ===
                // Trigger a new taunt every 5 score points
                if (score > 0 && score % 5 === 0 && score !== lastTauntScore.current) {
                    currentTaunt.current = TAUNT_MESSAGES[Math.floor(Math.random() * TAUNT_MESSAGES.length)]
                    currentVillainIndex.current = Math.floor(Math.random() * VILLAIN_PATHS.length) // Pick random villain!
                    tauntEndTime.current = Date.now() + 3000 // Show for 3 seconds
                    lastTauntScore.current = score
                }

                // Draw taunt popup if active
                if (currentTaunt.current && Date.now() < tauntEndTime.current) {
                    const tauntAlpha = Math.min(1, (tauntEndTime.current - Date.now()) / 500) // Fade out
                    ctx.globalAlpha = tauntAlpha

                    // Draw villain face in bottom-left corner
                    const faceSize = 80 * scale
                    const faceX = 15 * scale
                    const faceY = canvas.height - faceSize - 60 * scale

                    // Face border glow
                    ctx.shadowColor = '#ff0066'
                    ctx.shadowBlur = 15 * scale
                    ctx.strokeStyle = '#ff0066'
                    ctx.lineWidth = 3 * scale
                    ctx.strokeRect(faceX, faceY, faceSize, faceSize)
                    ctx.shadowBlur = 0

                    // Draw villain face - use random villain from array
                    const villainImg = villainSprites.current[currentVillainIndex.current]
                    if (villainImg) {
                        ctx.drawImage(villainImg, faceX, faceY, faceSize, faceSize)
                    } else {
                        ctx.fillStyle = '#333'
                        ctx.fillRect(faceX, faceY, faceSize, faceSize)
                    }

                    // Speech bubble
                    const bubbleX = faceX + faceSize + 10 * scale
                    const bubbleY = faceY
                    const bubbleWidth = Math.min(200 * scale, canvas.width - bubbleX - 20 * scale)
                    const bubbleHeight = 50 * scale

                    // Bubble background
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
                    ctx.strokeStyle = '#ff0066'
                    ctx.lineWidth = 2 * scale
                    ctx.beginPath()
                    ctx.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 8 * scale)
                    ctx.fill()
                    ctx.stroke()

                    // Bubble pointer
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
                    ctx.beginPath()
                    ctx.moveTo(bubbleX, bubbleY + 15 * scale)
                    ctx.lineTo(bubbleX - 10 * scale, bubbleY + 25 * scale)
                    ctx.lineTo(bubbleX, bubbleY + 35 * scale)
                    ctx.fill()

                    // Taunt text
                    ctx.fillStyle = '#ff0066'
                    ctx.shadowColor = '#ff0066'
                    ctx.shadowBlur = 5 * scale
                    ctx.font = `bold ${11 * scale}px monospace`
                    ctx.textAlign = 'left'

                    // Word wrap the text
                    const words = currentTaunt.current!.split(' ')
                    let line = ''
                    let y = bubbleY + 20 * scale
                    for (const word of words) {
                        const testLine = line + word + ' '
                        if (ctx.measureText(testLine).width > bubbleWidth - 20 * scale) {
                            ctx.fillText(line.trim(), bubbleX + 10 * scale, y)
                            line = word + ' '
                            y += 15 * scale
                        } else {
                            line = testLine
                        }
                    }
                    ctx.fillText(line.trim(), bubbleX + 10 * scale, y)
                    ctx.shadowBlur = 0
                    ctx.globalAlpha = 1
                } else if (Date.now() >= tauntEndTime.current) {
                    currentTaunt.current = null
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

