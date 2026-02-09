import { useEffect, useRef, useState, useCallback } from 'react'

const HIGH_SCORE_KEY = 'cyberpunk-flappy-highscores'
const MAX_HIGH_SCORES = 10
const SETTINGS_KEY = 'cyberpunk-flappy-settings'

type GraphicsQuality = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA' | 'CUSTOM'
type MenuScreen = 'MAIN' | 'OPTIONS'

interface GraphicsSettings {
    quality: GraphicsQuality
    fog: boolean
    skyline: boolean
    beacons: boolean
    flyingCars: boolean
    glow: boolean
    particles: boolean
    weatherFX: boolean
    birdGlow: boolean
    particleMultiplier: number
}

type Resolution = 'FIT' | '800x600' | '1024x768' | '1280x720' | '1920x1080'
type OptionsTab = 'GRAPHICS' | 'AUDIO'

const GRAPHICS_PRESETS: Record<Exclude<GraphicsQuality, 'CUSTOM'>, Omit<GraphicsSettings, 'quality'>> = {
    LOW: { fog: false, skyline: false, beacons: false, flyingCars: false, glow: false, particles: false, weatherFX: true, birdGlow: false, particleMultiplier: 0.5 },
    MEDIUM: { fog: false, skyline: true, beacons: true, flyingCars: false, glow: true, particles: true, weatherFX: true, birdGlow: false, particleMultiplier: 1 },
    HIGH: { fog: true, skyline: true, beacons: true, flyingCars: true, glow: true, particles: true, weatherFX: true, birdGlow: false, particleMultiplier: 1 },
    ULTRA: { fog: true, skyline: true, beacons: true, flyingCars: true, glow: true, particles: true, weatherFX: true, birdGlow: true, particleMultiplier: 2 },
}

const MENU_ITEMS_MAIN = ['START', 'OPTIONS'] as const

const loadSettings = (): GraphicsSettings | null => {
    try {
        const data = localStorage.getItem(SETTINGS_KEY)
        return data ? JSON.parse(data) : null
    } catch (_e) { return null }
}

const saveSettings = (settings: GraphicsSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

const loadHighScores = (): number[] => {
    try {
        const data = localStorage.getItem(HIGH_SCORE_KEY)
        return data ? JSON.parse(data) : []
    } catch (_e) { return [] }
}

const saveHighScore = (newScore: number): number[] => {
    const scores = loadHighScores()
    scores.push(newScore)
    scores.sort((a, b) => b - a)
    const top = scores.slice(0, MAX_HIGH_SCORES)
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(top))
    return top
}

// Polyfill for roundRect on older browsers/environments
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x: number, y: number, w: number, h: number, radii?: number | number[]) {
        if (!radii) radii = 0;
        if (typeof radii === 'number') radii = [radii];
        this.rect(x, y, w, h); // Fallback to simple rect
    };
}

const GameEngine = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [gameState, setGameState] = useState<'TITLE' | 'START' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'CREDITS'>('TITLE')
    const [score, setScore] = useState(0)
    const [resolution, setResolution] = useState<Resolution>('FIT')
    const [canvasSize, setCanvasSize] = useState({ width: 400, height: 600 })
    const [isMuted, setIsMuted] = useState(false)
    const [volume, setVolume] = useState(0.5)
    const [highScores, setHighScores] = useState<number[]>(loadHighScores())
    const scoreSaved = useRef(false)

    // Menu system
    const [menuScreen, setMenuScreen] = useState<MenuScreen>('MAIN')
    const [activeTab, setActiveTab] = useState<OptionsTab>('GRAPHICS')
    const selectedMenuItem = useRef(0)
    const mouseMenuItem = useRef(-1) // -1 = no hover
    const mousePos = useRef({ x: 0, y: 0 })

    // Graphics quality system
    const savedSettings = useRef(loadSettings())
    const [graphicsQuality, setGraphicsQuality] = useState<GraphicsQuality>(savedSettings.current?.quality || 'HIGH')

    // Performance: offscreen canvas for background caching
    const bgCanvas = useRef<HTMLCanvasElement | null>(null)
    const bgFrameCounter = useRef(0)
    const BG_CACHE_INTERVAL = 4 // Re-render background every N frames

    // Performance: shared AudioContext
    const sharedAudioCtx = useRef<AudioContext | null>(null)
    const getAudioCtx = useCallback(() => {
        if (!sharedAudioCtx.current || sharedAudioCtx.current.state === 'closed') {
            sharedAudioCtx.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        }
        return sharedAudioCtx.current
    }, [])

    // Performance: cache mobile detection
    const isMobileDevice = useRef('ontouchstart' in window || navigator.maxTouchPoints > 0)

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
    const startScreenSprite = useRef<HTMLImageElement | null>(null)
    const logoSprite = useRef<HTMLImageElement | null>(null)
    const dickySprite = useRef<HTMLImageElement | null>(null)
    const dickyBigSprite = useRef<HTMLImageElement | null>(null) // Blue pill transformation sprite
    const greenPillSprite = useRef<HTMLImageElement | null>(null)
    const bluePillSprite = useRef<HTMLImageElement | null>(null)
    const dickyAlt1 = useRef<HTMLImageElement | null>(null) // Alternate sprite 1
    const dickyAlt2 = useRef<HTMLImageElement | null>(null) // Alternate sprite 2
    const currentAltSprite = useRef<number>(0) // 0 = normal, 1 = alt1, 2 = alt2
    const altSpriteSwapTimer = useRef<number>(0) // Timer for next swap check

    // Parallax skyline backgrounds
    const skylineBack = useRef<HTMLImageElement | null>(null)
    const skylineFront = useRef<HTMLImageElement | null>(null)
    const skylineBack2 = useRef<HTMLImageElement | null>(null)
    const skylineFront2 = useRef<HTMLImageElement | null>(null)
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

    // Power-up system (green pill - good)
    const powerUpActive = useRef(false)
    const powerUpEndTime = useRef(0)
    const pill = useRef<{ x: number, y: number, rotation: number } | null>(null)
    const pillSpawnTimer = useRef(0)
    const projectiles = useRef<{ x: number, y: number, vy?: number }[]>([])

    // Poster power-up system (mega mode - bigger + multi-shot stream)
    const posterSprite = useRef<HTMLImageElement | null>(null)
    const posterActive = useRef(false)
    const posterEndTime = useRef(0)
    const poster = useRef<{ x: number, y: number, rotation: number } | null>(null)
    const posterSpawnTimer = useRef(0)
    const posterAutoFireTimer = useRef(0)
    const POSTER_DURATION = 6500 // 6.5 seconds
    const POSTER_SIZE_MULT = 1.25 // 25% bigger
    const POSTER_SPAWN_INTERVAL = 60 * 60 // ~60 seconds at 60fps

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

    // Sandstorm weather system - triggers at 60 points, lasts 12 seconds (17s after level 150)
    const sandParticles = useRef<{ x: number, y: number, speed: number, size: number, opacity: number }[]>([])
    const sandstormActiveRef = useRef(false)
    const sandstormEndTime = useRef(0)
    const lastSandstormScore = useRef(0)
    const SANDSTORM_TRIGGER_SCORE = 60
    const SANDSTORM_DURATION_BASE = 12000 // 12 seconds
    const SANDSTORM_DURATION_LVL2 = 17000 // 17 seconds after score 150
    const LEVEL_2_SCORE = 150
    const LEVEL_2_OVERLAY_END = 300

    // Ultra VFX: pill pickup particle burst
    const pillPickupParticles = useRef<{ x: number, y: number, vx: number, vy: number, life: number, maxLife: number, color: string, size: number }[]>([])

    // Ultra VFX: background rain layer (drawn behind main rain)
    const bgRainDrops = useRef<{ x: number, y: number, speed: number, length: number, vx: number }[]>([])

    // Ultra VFX: spotlight system
    const spotlightLastCheck = useRef(0) // timestamp of last 35s check
    const spotlightActive = useRef(false)
    const spotlightStartTime = useRef(0)
    const spotlightX = useRef(0) // circle center X
    const spotlightY = useRef(0) // circle center Y
    const spotlightVx = useRef(0) // wander velocity X
    const spotlightVy = useRef(0) // wander velocity Y
    const spotlightLockedOn = useRef(false)
    const spotlightLockTime = useRef(0)
    const spotlightLeftBehind = useRef(false)
    const SPOTLIGHT_LOCK_DELAY = 2500 // start locking after 2.5s
    const SPOTLIGHT_LEAVE_DELAY = 4500 // stop following after 4.5s

    // Dev mode controls
    const [devModeOpen, setDevModeOpen] = useState(false)
    const greenPillsEnabled = useRef(true)
    const bluePillsEnabled = useRef(true)
    const acidRainEnabled = useRef(true)
    const sandstormEnabled = useRef(true)
    const godMode = useRef(false)

    // Graphics toggles (dev mode)
    const showFog = useRef(savedSettings.current?.fog ?? true)
    const showBeacons = useRef(savedSettings.current?.beacons ?? true)
    const showFlyingCars = useRef(savedSettings.current?.flyingCars ?? true)
    const showGlow = useRef(savedSettings.current?.glow ?? true)
    const showParticles = useRef(savedSettings.current?.particles ?? true)
    const showSkyline = useRef(savedSettings.current?.skyline ?? true)
    const showWeatherFX = useRef(savedSettings.current?.weatherFX ?? true)
    const showBirdGlow = useRef(savedSettings.current?.birdGlow ?? false)
    const particleMultiplier = useRef(savedSettings.current?.particleMultiplier ?? 1)

    // Fullscreen & mobile view
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [simulateMobile, setSimulateMobile] = useState(false)

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
        "Where's my dog, Dicky!?!",
        "I see you, Dicky!",
        "Your time is up!",
        "Keep flying... it won't help!",
        "Nowhere to run, Dicky!",
        "You're toast, Dicky!",
        "You're done, Dicky!",
        "You're finished, Dicky!",
        "Are you little Dicky or a little Puss?",
        "This ends now!"
    ]

    // Phase 2 Boss intro system
    const bossSprite = useRef<HTMLImageElement | null>(null)
    const bossIntroActive = useRef(false)
    const bossIntroStartTime = useRef(0)
    const bossIntroTriggered = useRef(false)
    const bossMessageIndex = useRef(0)
    const bossCharIndex = useRef(0)
    const bossLastCharTime = useRef(0)
    const BOSS_MESSAGES = [
        "I hope you enjoyed your little headstart, Dicky.",
        "But it's over now.",
        "I'm coming for you.",
        "Level 2 starts NOW."
    ]
    const BOSS_GLITCH_DURATION = 3000 // 3 seconds of glitching
    const BOSS_MESSAGE_CHAR_SPEED = 40 // ms per character (typewriter)
    const BOSS_MESSAGE_PAUSE = 1200 // pause between messages


    // Audio
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const menuAudioRef = useRef<HTMLAudioElement | null>(null)
    const citySoundsRef = useRef<HTMLAudioElement | null>(null)
    const songLevel = useRef(1) // Track current song (1 = background.mp3, 2 = level2.mp3)

    // Audio State Management
    useEffect(() => {
        const menuAudio = menuAudioRef.current
        const gameAudio = audioRef.current
        const citySounds = citySoundsRef.current

        const updateAudio = () => {
            if (!menuAudio || !gameAudio || !citySounds) return

            menuAudio.volume = isMuted ? 0 : volume
            gameAudio.volume = isMuted ? 0 : volume
            citySounds.volume = (isMuted ? 0 : volume) * 0.65

            if (isMuted) {
                menuAudio.pause()
                gameAudio.pause()
                citySounds.pause()
                return
            }

            // Global Ambient Loop
            if (citySounds.paused) {
                citySounds.play().catch(() => { })
            }

            if (gameState === 'PLAYING') {
                menuAudio.pause()
                menuAudio.currentTime = 0
                // Game audio is handled by start/level logic primarily, but ensure it's playing if meant to be
                if (gameAudio.paused && gameAudio.src) gameAudio.play().catch(() => { })
            } else {
                // TITLE, START, OPTIONS, PAUSED, GAME_OVER
                gameAudio.pause()
                if (menuAudio.paused) {
                    menuAudio.play().catch(() => { })
                }
            }
        }
        updateAudio()
    }, [gameState, isMuted, volume])

    const toggleMute = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation() // Prevent triggering jump
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
            const ctx = getAudioCtx()
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
    }, [isMuted, getAudioCtx])

    const playExplosionSound = useCallback(() => {
        if (isMuted) return
        try {
            const ctx = getAudioCtx()
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
    }, [isMuted, getAudioCtx])


    // Resize handler (supports mobile simulation & fullscreen & resolution settings)
    useEffect(() => {
        const handleResize = () => {
            if (simulateMobile) {
                // Simulate iPhone SE / small phone dimensions
                setCanvasSize({ width: 250, height: 375 })
                isMobileDevice.current = true
                return
            }
            if (document.fullscreenElement) {
                // Fullscreen: fill entire window
                setCanvasSize({ width: window.innerWidth, height: window.innerHeight })
                isMobileDevice.current = false
                return
            }

            // Handle explicit resolutions
            if (resolution !== 'FIT') {
                const [w, h] = resolution.split('x').map(Number)
                setCanvasSize({ width: w, height: h })
                isMobileDevice.current = false
                return
            }

            const vh = window.innerHeight
            const aspectRatio = 400 / 600 // Original aspect ratio
            const newHeight = vh - 40 // Leave some padding
            const newWidth = newHeight * aspectRatio
            setCanvasSize({ width: Math.floor(newWidth), height: Math.floor(newHeight) })
            isMobileDevice.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0
        }
        handleResize()
        window.addEventListener('resize', handleResize)

        // Fullscreen change listener — also trigger resize
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
            // Need a small delay for the browser to update innerWidth/Height
            setTimeout(handleResize, 50)
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange)

        return () => {
            window.removeEventListener('resize', handleResize)
            document.removeEventListener('fullscreenchange', handleFullscreenChange)
        }
    }, [simulateMobile, resolution])

    // Load sprites
    useEffect(() => {
        const startImg = new Image()
        startImg.src = '/start screen.png'
        startImg.onload = () => { startScreenSprite.current = startImg }

        const logoImg = new Image()
        logoImg.src = '/Logo.png'
        logoImg.onload = () => { logoSprite.current = logoImg }

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
        // Level 2 backdrops (score 150+)
        const skyBack2 = new Image()
        skyBack2.src = '/2back.png'
        skyBack2.onload = () => skylineBack2.current = skyBack2
        const skyFront2 = new Image()
        skyFront2.src = '/2front.png'
        skyFront2.onload = () => skylineFront2.current = skyFront2
        // Load pill sprites
        const greenPillImg = new Image()
        greenPillImg.src = '/greenpill.png'
        greenPillImg.onload = () => greenPillSprite.current = greenPillImg
        const bluePillImg = new Image()
        bluePillImg.src = '/bluepill.png'
        bluePillImg.onload = () => bluePillSprite.current = bluePillImg
        // Load poster sprite
        const posterImg = new Image()
        posterImg.src = '/poster.png'
        posterImg.onload = () => posterSprite.current = posterImg
        // Load boss sprite
        const bossImg = new Image()
        bossImg.src = '/boss.png'
        bossImg.onload = () => bossSprite.current = bossImg
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

    // Dev mode keyboard listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '`' || e.key === '~') {
                setDevModeOpen(prev => !prev)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    // Apply a graphics preset to all refs and save to localStorage
    const applyGraphicsPreset = (quality: Exclude<GraphicsQuality, 'CUSTOM'>) => {
        const preset = GRAPHICS_PRESETS[quality]
        showFog.current = preset.fog
        showSkyline.current = preset.skyline
        showBeacons.current = preset.beacons
        showFlyingCars.current = preset.flyingCars
        showGlow.current = preset.glow
        showParticles.current = preset.particles
        showWeatherFX.current = preset.weatherFX
        showBirdGlow.current = preset.birdGlow
        particleMultiplier.current = preset.particleMultiplier
        bgFrameCounter.current = 0
        setGraphicsQuality(quality)
        saveSettings({ quality, ...preset })
    }

    const saveCurrentSettings = () => {
        const settings: GraphicsSettings = {
            quality: graphicsQuality,
            fog: showFog.current,
            skyline: showSkyline.current,
            beacons: showBeacons.current,
            flyingCars: showFlyingCars.current,
            glow: showGlow.current,
            particles: showParticles.current,
            weatherFX: showWeatherFX.current,
            birdGlow: showBirdGlow.current,
            particleMultiplier: particleMultiplier.current,
        }
        saveSettings(settings)
    }

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
        scoreSaved.current = false
        // Reset sandstorm
        sandstormActiveRef.current = false
        sandstormEndTime.current = 0
        lastSandstormScore.current = 0
        sandParticles.current = []
        // Reset poster
        posterActive.current = false
        posterEndTime.current = 0
        poster.current = null
        posterSpawnTimer.current = 0
        posterAutoFireTimer.current = 0
        // Reset boss intro
        bossIntroActive.current = false
        bossIntroTriggered.current = false
        bossIntroStartTime.current = 0
        bossMessageIndex.current = 0
        bossCharIndex.current = 0
        // Reset Ultra VFX
        pillPickupParticles.current = []
        bgRainDrops.current = []
        spotlightActive.current = false
        spotlightLastCheck.current = 0
        setGameState('START')
    }

    const startGame = () => {
        resetGame()
        setGameState('PLAYING')
        gameStartTime.current = Date.now() // Track when game started for acid rain
        // Start background music (reset to song 1)
        if (audioRef.current) {
            songLevel.current = 1
            audioRef.current.src = '/background.mp3'
            audioRef.current.loop = false
            audioRef.current.currentTime = 0
            audioRef.current.volume = isMuted ? 0 : volume
            audioRef.current.play().catch(() => { })
        }
    }

    // Update volume when changed
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = isMuted ? 0 : volume
        }
    }, [volume, isMuted])

    const GRAPHICS_ITEMS = ['QUALITY', 'RESOLUTION', 'Fog', 'Skyline', 'Beacons', 'Flying Cars', 'Glow Effects', 'Particles', 'Weather FX', 'Bird Glow', 'BACK'] as const
    const AUDIO_ITEMS = ['Master Volume', 'Music Volume', 'BACK'] as const
    const TABS: OptionsTab[] = ['GRAPHICS', 'AUDIO']
    const QUALITY_ORDER: Exclude<GraphicsQuality, 'CUSTOM'>[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']
    const RESOLUTION_ORDER: Resolution[] = ['FIT', '800x600', '1024x768', '1280x720', '1920x1080']

    const handleMenuSelect = () => {
        if (menuScreen === 'MAIN') {
            const item = MENU_ITEMS_MAIN[selectedMenuItem.current]
            if (item === 'START') {
                startGame()
            } else if (item === 'OPTIONS') {
                setMenuScreen('OPTIONS')
                setActiveTab('GRAPHICS')
                selectedMenuItem.current = 0
            }
        } else if (menuScreen === 'OPTIONS') {
            const currentItems = activeTab === 'GRAPHICS' ? GRAPHICS_ITEMS : AUDIO_ITEMS
            const item = currentItems[selectedMenuItem.current]

            if (item === 'BACK') {
                setMenuScreen('MAIN')
                selectedMenuItem.current = 1 // highlight OPTIONS
            } else if (activeTab === 'GRAPHICS') {
                if (item === 'QUALITY') {
                    // Cycle forward through presets on Enter
                    const idx = QUALITY_ORDER.indexOf(graphicsQuality as Exclude<GraphicsQuality, 'CUSTOM'>)
                    const next = QUALITY_ORDER[(idx + 1) % QUALITY_ORDER.length]
                    applyGraphicsPreset(next)
                } else if (item === 'RESOLUTION') {
                    const idx = RESOLUTION_ORDER.indexOf(resolution)
                    const next = RESOLUTION_ORDER[(idx + 1) % RESOLUTION_ORDER.length]
                    setResolution(next)
                } else {
                    // Toggle individual setting
                    toggleOptionItem(item as string)
                }
            } else if (activeTab === 'AUDIO') {
                // Audio toggles handled via sliders usually, but ENTER could toggle mute?
                if (item === 'Master Volume') {
                    toggleMute()
                }
            }
        }
    }

    const toggleOptionItem = (item: string) => {
        switch (item) {
            case 'Fog': showFog.current = !showFog.current; bgFrameCounter.current = 0; break
            case 'Skyline': showSkyline.current = !showSkyline.current; break
            case 'Beacons': showBeacons.current = !showBeacons.current; break
            case 'Flying Cars': showFlyingCars.current = !showFlyingCars.current; break
            case 'Glow Effects': showGlow.current = !showGlow.current; break
            case 'Particles': showParticles.current = !showParticles.current; break
            case 'Weather FX': showWeatherFX.current = !showWeatherFX.current; break
            case 'Bird Glow': showBirdGlow.current = !showBirdGlow.current; break
        }
        setGraphicsQuality('CUSTOM')
        saveCurrentSettings()
    }

    const getOptionValue = (item: string): boolean => {
        switch (item) {
            case 'Fog': return showFog.current
            case 'Skyline': return showSkyline.current
            case 'Beacons': return showBeacons.current
            case 'Flying Cars': return showFlyingCars.current
            case 'Glow Effects': return showGlow.current
            case 'Particles': return showParticles.current
            case 'Weather FX': return showWeatherFX.current
            case 'Bird Glow': return showBirdGlow.current
            default: return false
        }
    }

    const jump = () => {
        if (gameState === 'PLAYING') {
            const scale = getScale()
            const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
            const mobileSpeedMult = isMobile ? 1.3 : 1
            birdVelocity.current = LIFT * scale * mobileSpeedMult





            // Fire projectile if power-up is active
            if (powerUpActive.current || posterActive.current) {
                if (posterActive.current) {
                    // Multi-directional spread
                    const angles = [-0.3, -0.15, 0, 0.15, 0.3]
                    for (const angle of angles) {
                        projectiles.current.push({ x: 80 * scale, y: birdY.current + 15 * scale, vy: Math.sin(angle) * 4 * scale })
                    }
                } else {
                    projectiles.current.push({ x: 80 * scale, y: birdY.current + 15 * scale })
                }
            }
        } else if (gameState === 'START') {
            if (mouseMenuItem.current !== -1) {
                selectedMenuItem.current = mouseMenuItem.current
                handleMenuSelect()
            } else if (menuScreen === 'OPTIONS' && mousePos.current) {
                // Check if clicked ON a tab (using tracked mouse position)
                const s = canvasSize.height / 600
                const panelW = 320 * s
                const panelX = canvasSize.width / 2 - panelW / 2
                const panelY = canvasSize.height / 2 - 200 * s
                const tabW = panelW / 2
                const tabH = 40 * s
                const mx = mousePos.current.x
                const my = mousePos.current.y

                for (let i = 0; i < TABS.length; i++) {
                    const tabX = panelX + i * tabW
                    if (mx >= tabX && mx <= tabX + tabW && my >= panelY && my <= panelY + tabH) {
                        setActiveTab(TABS[i])
                        selectedMenuItem.current = 0
                        return
                    }
                }
            }
        } else if (gameState === 'GAME_OVER') {
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
            // Dev toggle overrides everything
            if (e.key === '`' || e.key === '~') return

            if (gameState === 'TITLE') {
                // Any key starts the game menu (Attract Mode -> Menu)
                e.preventDefault()
                setGameState('START')
            } else if (gameState === 'START') {
                // Menu navigation
                // Tab Switching (Q/E or Tab)
                if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'Tab') {
                    e.preventDefault() // Prevent focus loss on Tab
                    const idx = TABS.indexOf(activeTab)
                    const nextIdx = (idx + 1) % TABS.length
                    setActiveTab(TABS[nextIdx])
                    selectedMenuItem.current = 0
                }

                // List Navigation
                if (e.code === 'ArrowUp') {
                    e.preventDefault()
                    const items = menuScreen === 'MAIN' ? MENU_ITEMS_MAIN : (activeTab === 'GRAPHICS' ? GRAPHICS_ITEMS : AUDIO_ITEMS)
                    selectedMenuItem.current = (selectedMenuItem.current - 1 + items.length) % items.length
                } else if (e.code === 'ArrowDown') {
                    e.preventDefault()
                    const items = menuScreen === 'MAIN' ? MENU_ITEMS_MAIN : (activeTab === 'GRAPHICS' ? GRAPHICS_ITEMS : AUDIO_ITEMS)
                    selectedMenuItem.current = (selectedMenuItem.current + 1) % items.length
                }

                // Specific Graphics Settings Adjustments
                else if (activeTab === 'GRAPHICS') {
                    if (e.code === 'ArrowLeft' && selectedMenuItem.current === 0) {
                        e.preventDefault()
                        const idx = QUALITY_ORDER.indexOf(graphicsQuality as Exclude<GraphicsQuality, 'CUSTOM'>)
                        const prev = QUALITY_ORDER[(idx - 1 + QUALITY_ORDER.length) % QUALITY_ORDER.length]
                        applyGraphicsPreset(prev)
                    } else if (e.code === 'ArrowRight' && selectedMenuItem.current === 0) {
                        e.preventDefault()
                        const idx = QUALITY_ORDER.indexOf(graphicsQuality as Exclude<GraphicsQuality, 'CUSTOM'>)
                        const next = QUALITY_ORDER[(idx + 1) % QUALITY_ORDER.length]
                        applyGraphicsPreset(next)
                    }
                }

                // Audio Settings Adjustments
                else if (activeTab === 'AUDIO') {
                    const items = AUDIO_ITEMS
                    const item = items[selectedMenuItem.current]
                    if (item === 'Master Volume' || item === 'Music Volume') {
                        if (e.code === 'ArrowLeft') {
                            setVolume(v => Math.max(0, v - 0.1))
                        } else if (e.code === 'ArrowRight') {
                            setVolume(v => Math.min(1, v + 0.1))
                        }
                    }
                }

                if (e.code === 'Space' || e.code === 'Enter') {
                    e.preventDefault()
                    handleMenuSelect()
                } else if (e.code === 'Escape' && menuScreen === 'OPTIONS') {
                    e.preventDefault()
                    setMenuScreen('MAIN')
                    selectedMenuItem.current = 1
                }
            } else if (gameState === 'PLAYING') {
                if (e.code === 'Space' || e.code === 'ArrowUp') {
                    e.preventDefault()
                    jump()
                } else if (e.code === 'Escape' || e.code === 'Enter') {
                    e.preventDefault()
                    togglePause()
                }
            } else if (gameState === 'PAUSED') {
                if (e.code === 'Escape' || e.code === 'Enter') {
                    e.preventDefault()
                    togglePause()
                    if (menuScreen === 'MAIN') {
                        // ... existing main menu code ...
                    }
                }

            } else if (gameState === 'GAME_OVER') {
                if (e.code === 'Space' || e.code === 'Enter') {
                    e.preventDefault()
                    startGame()
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [gameState, canvasSize, menuScreen, graphicsQuality])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const scale = getScale()
        // Mobile speed boost - use cached detection
        const isMobile = isMobileDevice.current
        const mobileSpeedMult = isMobile ? 1.3 : 1
        const scaledGravity = GRAVITY * scale * mobileSpeedMult
        // Dynamic values based on blue pill status
        const bluePillMult = bluePillActive.current ? BLUE_PILL_SPEED_MULT : 1
        const sandstormMult = sandstormActiveRef.current ? BLUE_PILL_SPEED_MULT : 1  // Same speed as blue pill
        const scaledPipeSpeed = PIPE_SPEED * scale * bluePillMult * sandstormMult * mobileSpeedMult
        const scaledPipeGap = PIPE_GAP * scale
        const posterSizeMult = posterActive.current ? POSTER_SIZE_MULT : 1
        const birdSizeMult = (bluePillActive.current ? BLUE_PILL_SIZE_MULT : 1) * posterSizeMult
        const scaledBirdSize = 30 * scale * birdSizeMult
        // Dynamic Bird X Position (20% of screen width)
        const scaledBirdX = Math.min(canvas.width * 0.2, 300 * scale)
        const scaledPipeWidth = 50 * scale

        const render = () => {
            try {
                // Global Animation Counter (independent of game state)
                const globalTime = Date.now() * 0.05

                // ===== NEO-TOKYO 3D PERSPECTIVE CITYSCAPE =====
                const W = canvas.width
                const H = canvas.height
                const centerX = W / 2


                const HORIZON_Y = H * 0.35 // Horizon line
                const GROUND_Y = H - 20 * scale    // Ground level

                // Seeded random for consistent rendering
                const seededRand = (seed: number) => {
                    const x = Math.sin(seed * 12.9898) * 43758.5453
                    return x - Math.floor(x)
                }

                // === CACHED BACKGROUND RENDERING ===
                // Sky gradient, neon glows, light beams, haze, and fog change very slowly
                // so we cache them on an offscreen canvas and re-render every N frames
                const needsBgUpdate = bgFrameCounter.current % BG_CACHE_INTERVAL === 0

                if (!bgCanvas.current || bgCanvas.current.width !== W || bgCanvas.current.height !== H) {
                    bgCanvas.current = document.createElement('canvas')
                    bgCanvas.current.width = W
                    bgCanvas.current.height = H
                }

                if (needsBgUpdate) {
                    const bgCtx = bgCanvas.current.getContext('2d')!

                    // --- SKY GRADIENT (Animated - dynamic color shift) ---
                    const timeShift = Math.sin(globalTime * 0.01) * 0.1
                    const skyGrad = bgCtx.createLinearGradient(0, 0, 0, HORIZON_Y + 150 * scale)
                    skyGrad.addColorStop(0, '#0d0d1a')
                    skyGrad.addColorStop(0.15, `hsl(${240 + Math.sin(globalTime * 0.008) * 10}, 30%, ${8 + timeShift * 3}%)`)
                    skyGrad.addColorStop(0.4, `hsl(${210 + Math.sin(globalTime * 0.006) * 15}, 25%, ${18 + timeShift * 5}%)`)
                    skyGrad.addColorStop(0.7, `hsl(${200 + Math.sin(globalTime * 0.004) * 20}, 20%, ${28 + timeShift * 4}%)`)
                    skyGrad.addColorStop(1, `hsl(${190 + Math.sin(globalTime * 0.003) * 25}, 15%, ${35 + timeShift * 3}%)`)
                    bgCtx.fillStyle = skyGrad
                    bgCtx.fillRect(0, 0, W, H)

                    // --- PULSING NEON HORIZON GLOW ---
                    const neonPulse1 = (Math.sin(globalTime * 0.04) + 1) / 2
                    const neonPulse2 = (Math.sin(globalTime * 0.03 + 1) + 1) / 2
                    const neonPulse3 = (Math.sin(globalTime * 0.025 + 2) + 1) / 2

                    // Magenta glow
                    const magentaGlow = bgCtx.createRadialGradient(
                        W * 0.3, HORIZON_Y + 30 * scale, 0,
                        W * 0.3, HORIZON_Y + 30 * scale, 200 * scale
                    )
                    magentaGlow.addColorStop(0, `rgba(255, 0, 150, ${0.15 + neonPulse1 * 0.15})`)
                    magentaGlow.addColorStop(0.5, `rgba(255, 0, 100, ${0.08 + neonPulse1 * 0.08})`)
                    magentaGlow.addColorStop(1, 'rgba(255, 0, 80, 0)')
                    bgCtx.fillStyle = magentaGlow
                    bgCtx.fillRect(0, 0, W, H)

                    // Cyan glow
                    const cyanGlow = bgCtx.createRadialGradient(
                        W * 0.7, HORIZON_Y + 20 * scale, 0,
                        W * 0.7, HORIZON_Y + 20 * scale, 180 * scale
                    )
                    cyanGlow.addColorStop(0, `rgba(0, 255, 255, ${0.12 + neonPulse2 * 0.12})`)
                    cyanGlow.addColorStop(0.5, `rgba(0, 200, 255, ${0.06 + neonPulse2 * 0.06})`)
                    cyanGlow.addColorStop(1, 'rgba(0, 150, 255, 0)')
                    bgCtx.fillStyle = cyanGlow
                    bgCtx.fillRect(0, 0, W, H)

                    // Purple center glow
                    const purpleGlow = bgCtx.createRadialGradient(
                        W * 0.5, HORIZON_Y, 0,
                        W * 0.5, HORIZON_Y, 250 * scale
                    )
                    purpleGlow.addColorStop(0, `rgba(150, 50, 255, ${0.1 + neonPulse3 * 0.1})`)
                    purpleGlow.addColorStop(0.6, `rgba(100, 0, 200, ${0.05 + neonPulse3 * 0.05})`)
                    purpleGlow.addColorStop(1, 'rgba(50, 0, 100, 0)')
                    bgCtx.fillStyle = purpleGlow
                    bgCtx.fillRect(0, 0, W, H)

                    // --- SWEEPING LIGHT BEAMS ---
                    bgCtx.globalAlpha = 0.03
                    for (let beam = 0; beam < 3; beam++) {
                        const beamAngle = (globalTime * 0.02 + beam * 2) % (Math.PI * 2)
                        const beamX = W * 0.5 + Math.cos(beamAngle) * W * 0.4
                        const beamGrad = bgCtx.createLinearGradient(beamX, 0, beamX + 100 * scale, HORIZON_Y)
                        beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0)')
                        beamGrad.addColorStop(0.5, `rgba(${beam === 0 ? '255,100,255' : beam === 1 ? '100,255,255' : '255,255,100'}, 1)`)
                        beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
                        bgCtx.fillStyle = beamGrad
                        bgCtx.beginPath()
                        bgCtx.moveTo(beamX - 30 * scale, 0)
                        bgCtx.lineTo(beamX + 30 * scale, 0)
                        bgCtx.lineTo(beamX + 80 * scale, HORIZON_Y)
                        bgCtx.lineTo(beamX - 80 * scale, HORIZON_Y)
                        bgCtx.closePath()
                        bgCtx.fill()
                    }
                    bgCtx.globalAlpha = 1

                    // --- DISTANT CITY HAZE (atmospheric glow - animated) ---
                    const hazeOffset = Math.sin(globalTime * 0.015) * 30 * scale
                    const hazeGrad = bgCtx.createRadialGradient(W / 2 + hazeOffset, HORIZON_Y + 50 * scale, 0, W / 2, HORIZON_Y + 50 * scale, W * 0.7)
                    hazeGrad.addColorStop(0, 'rgba(100, 160, 180, 0.3)')
                    hazeGrad.addColorStop(0.3, 'rgba(80, 140, 160, 0.2)')
                    hazeGrad.addColorStop(0.6, 'rgba(60, 100, 120, 0.1)')
                    hazeGrad.addColorStop(1, 'rgba(30, 40, 50, 0)')
                    bgCtx.fillStyle = hazeGrad
                    bgCtx.fillRect(0, 0, W, H)

                    // --- DRIFTING FOG LAYERS (per-ellipse radial gradients for soft edges) ---
                    const drawFogLayer = (yBase: number, speed: number, alpha: number, fogScale: number) => {
                        const fogOffset = (globalTime * speed) % (W * 2)

                        for (let fx = -W; fx < W * 2; fx += 60 * fogScale * scale) {
                            const fogY = yBase + Math.sin((fx + fogOffset) * 0.01) * 15 * scale
                            const fogW = (80 + Math.sin(fx * 0.02) * 30) * scale
                            const fogH = (8 + Math.sin(fx * 0.03) * 4) * scale

                            const cx = fx - fogOffset + fogW / 2
                            const rW = fogW * fogScale
                            const rH = fogH * fogScale

                            // Per-ellipse radial gradient for soft, natural fog
                            bgCtx.save()
                            bgCtx.globalAlpha = alpha
                            bgCtx.translate(cx, fogY)
                            bgCtx.scale(rW / rH, 1)
                            const grad = bgCtx.createRadialGradient(0, 0, 0, 0, 0, rH)
                            grad.addColorStop(0, 'rgba(120, 140, 160, 0.6)')
                            grad.addColorStop(0.5, 'rgba(100, 120, 140, 0.3)')
                            grad.addColorStop(1, 'rgba(80, 100, 120, 0)')
                            bgCtx.fillStyle = grad
                            bgCtx.beginPath()
                            bgCtx.arc(0, 0, rH, 0, Math.PI * 2)
                            bgCtx.fill()
                            bgCtx.restore()
                        }
                        bgCtx.globalAlpha = 1
                    }

                    if (showFog.current) {
                        drawFogLayer(HORIZON_Y - 30 * scale, 0.3, 0.15, 1.5)
                        drawFogLayer(HORIZON_Y + 20 * scale, 0.5, 0.12, 1.2)
                        drawFogLayer(HORIZON_Y + 80 * scale, 0.8, 0.08, 1.0)
                    }
                }
                bgFrameCounter.current++

                // Draw cached background to main canvas
                ctx.drawImage(bgCanvas.current, 0, 0)



                // === PARALLAX SKYLINE BACKGROUNDS ===
                if (showSkyline.current) {
                    const skyScrollSpeed = scaledPipeSpeed * 0.3

                    // Choose skyline based on score level
                    const useLevel2 = score >= LEVEL_2_SCORE
                    const activeBack = useLevel2 && skylineBack2.current ? skylineBack2.current : skylineBack.current
                    const activeFront = useLevel2 && skylineFront2.current ? skylineFront2.current : skylineFront.current

                    // Draw back skyline (slower, distant)
                    if (activeBack) {
                        skylineBackX.current -= skyScrollSpeed * 0.3
                        const backH = GROUND_Y - HORIZON_Y + 50 * scale
                        const backW = activeBack.width * (backH / activeBack.height)
                        if (skylineBackX.current <= -backW) skylineBackX.current = 0
                        ctx.globalAlpha = 0.7
                        ctx.drawImage(activeBack, skylineBackX.current, HORIZON_Y - 50 * scale, backW, backH)
                        ctx.drawImage(activeBack, skylineBackX.current + backW, HORIZON_Y - 50 * scale, backW, backH)
                        ctx.globalAlpha = 1
                    }

                    // Draw front skyline (faster, closer)
                    if (activeFront) {
                        skylineFrontX.current -= skyScrollSpeed * 0.6
                        const frontH = GROUND_Y - HORIZON_Y + 80 * scale
                        const frontW = activeFront.width * (frontH / activeFront.height)
                        if (skylineFrontX.current <= -frontW) skylineFrontX.current = 0
                        ctx.drawImage(activeFront, skylineFrontX.current, HORIZON_Y - 80 * scale, frontW, frontH)
                        ctx.drawImage(activeFront, skylineFrontX.current + frontW, HORIZON_Y - 80 * scale, frontW, frontH)
                    }

                    // Persistent yellow overlay for level 2 (score 150-300)
                    if (score >= LEVEL_2_SCORE && score < LEVEL_2_OVERLAY_END) {
                        ctx.fillStyle = 'rgba(180, 140, 60, 0.08)'
                        ctx.fillRect(0, 0, canvas.width, canvas.height)
                    }

                } // end showSkyline

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
                if (showFlyingCars.current) {
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
                } // end showFlyingCars

                // === RAILCART ANIMATION (runs on top teal bridge line) ===
                const TOP_RAIL_Y = GROUND_Y - 180 * scale // Top teal bridge position
                if (gameState === 'PLAYING') {
                    railcartSpawnTimer.current++
                    // Random spawn every ~10-15 seconds (600+ frames at 60fps)
                    if (!railcart.current && railcartSpawnTimer.current > 600 && Math.random() < 0.008) {
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
                ctx.lineWidth = 2 * scale
                // Manual glow: wider faded line behind
                if (showGlow.current) {
                    ctx.globalAlpha = 0.2
                    ctx.lineWidth = 8 * scale
                    ctx.beginPath()
                    ctx.moveTo(0, GROUND_Y)
                    ctx.lineTo(W, GROUND_Y)
                    ctx.stroke()
                    ctx.globalAlpha = 1
                    ctx.lineWidth = 2 * scale
                }
                ctx.beginPath()
                ctx.moveTo(0, GROUND_Y)
                ctx.lineTo(W, GROUND_Y)
                ctx.stroke()

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
                if (showBeacons.current) {
                    const beaconPositions = [
                        { x: 95 * scale, y: GROUND_Y - 340 * scale },
                        { x: 230 * scale, y: GROUND_Y - 420 * scale },
                        { x: 350 * scale, y: GROUND_Y - 310 * scale },
                    ]

                    beaconPositions.forEach((beacon, idx) => {
                        const beaconAngle = (globalTime * 0.03 + idx * 2.1) % (Math.PI * 2)

                        // Drone drift - gentle movement around base position
                        const driftX = Math.sin(globalTime * 0.02 + idx * 1.7) * 12 * scale
                        const driftY = Math.cos(globalTime * 0.015 + idx * 2.3) * 8 * scale
                        const bx = beacon.x + driftX
                        const by = beacon.y + driftY

                        // Radial gradient glow behind beacon
                        const glowRadius = 14 * scale
                        const glowGrad = ctx.createRadialGradient(bx, by, 0, bx, by, glowRadius)
                        glowGrad.addColorStop(0, 'rgba(255, 0, 0, 0.8)')
                        glowGrad.addColorStop(1, 'rgba(255, 0, 0, 0)')
                        ctx.fillStyle = glowGrad
                        ctx.beginPath()
                        ctx.arc(bx, by, glowRadius, 0, Math.PI * 2)
                        ctx.fill()

                        // Core dot
                        ctx.fillStyle = '#ff0000'
                        ctx.beginPath()
                        ctx.arc(bx, by, 4 * scale, 0, Math.PI * 2)
                        ctx.fill()

                        const beamLength = 150 * scale
                        const beamWidth = 0.25

                        const beamGrad = ctx.createRadialGradient(bx, by, 0, bx, by, beamLength)
                        beamGrad.addColorStop(0, 'rgba(255, 50, 50, 0.4)')
                        beamGrad.addColorStop(0.3, 'rgba(255, 30, 30, 0.2)')
                        beamGrad.addColorStop(1, 'rgba(255, 0, 0, 0)')

                        ctx.fillStyle = beamGrad
                        ctx.beginPath()
                        ctx.moveTo(bx, by)
                        ctx.arc(bx, by, beamLength, beaconAngle - beamWidth, beaconAngle + beamWidth)
                        ctx.lineTo(bx, by) // Close the arc segment to the center
                        ctx.closePath()
                        ctx.fill()
                    })
                } // end showBeacons

                // === FOREGROUND FOG (per-ellipse radial gradients for soft edges) ===
                if (showFog.current) {
                    const fgFogOffset = (globalTime * 0.4) % (W * 1.5)

                    for (let fx = -100 * scale; fx < W + 200 * scale; fx += 40 * scale) {
                        const fogY = GROUND_Y - 30 * scale + Math.sin((fx + fgFogOffset) * 0.015) * 12 * scale
                        const fogW = (70 + Math.sin(fx * 0.03 + globalTime * 0.01) * 25) * scale
                        const fogH = (18 + Math.sin(fx * 0.02) * 6) * scale

                        const cx = fx - fgFogOffset + fogW / 2

                        // Per-ellipse radial gradient for natural fog glow
                        ctx.save()
                        ctx.globalAlpha = 0.2
                        ctx.translate(cx, fogY)
                        ctx.scale(fogW / fogH, 1)
                        const fogGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, fogH)
                        fogGrad.addColorStop(0, 'rgba(80, 110, 140, 0.7)')
                        fogGrad.addColorStop(0.5, 'rgba(60, 90, 120, 0.35)')
                        fogGrad.addColorStop(1, 'rgba(50, 70, 100, 0)')
                        ctx.fillStyle = fogGrad
                        ctx.beginPath()
                        ctx.arc(0, 0, fogH, 0, Math.PI * 2)
                        ctx.fill()
                        ctx.restore()
                    }

                    const groundFogGrad = ctx.createLinearGradient(0, GROUND_Y - 50 * scale, 0, GROUND_Y + 10 * scale)
                    groundFogGrad.addColorStop(0, 'rgba(60, 80, 100, 0)')
                    groundFogGrad.addColorStop(0.5, 'rgba(70, 90, 110, 0.25)')
                    groundFogGrad.addColorStop(1, 'rgba(80, 100, 120, 0.4)')
                    ctx.fillStyle = groundFogGrad
                    ctx.fillRect(0, GROUND_Y - 50 * scale, W, 60 * scale)

                    ctx.globalAlpha = 1
                } // end showFog foreground

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

                // Apply glow effects (gated behind birdGlow setting - Ultra only by default)
                if (showBirdGlow.current) {
                    if (bluePillActive.current) {
                        ctx.shadowColor = '#0088ff'
                        ctx.shadowBlur = 20 * scale
                    } else if (powerUpActive.current) {
                        ctx.shadowColor = '#00ff00'
                        ctx.shadowBlur = 20 * scale
                    }
                }

                // Draw the sprite or fallback to colored square
                if (posterActive.current && dickyAlt2.current) {
                    // Poster mega mode - use dicky_alt2!
                    const spriteW = scaledBirdSize * 3.5
                    const spriteH = scaledBirdSize * 2.5
                    if (showBirdGlow.current) {
                        ctx.shadowColor = '#ff8800'
                        ctx.shadowBlur = 25 * scale
                    }
                    ctx.drawImage(dickyAlt2.current, -spriteW / 2, -spriteH / 2, spriteW, spriteH)
                    ctx.shadowBlur = 0
                } else if (bluePillActive.current && dickyBigSprite.current) {
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

                    if (gameState === 'PLAYING' || gameState === 'GAME_OVER' || gameState === 'PAUSED') {
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
                }

                ctx.restore()
                ctx.shadowBlur = 0

                if (gameState === 'PLAYING') {
                    if (powerUpActive.current && Date.now() > powerUpEndTime.current) {
                        powerUpActive.current = false
                    }

                    birdVelocity.current += scaledGravity
                    birdY.current += birdVelocity.current

                    // God mode: prevent falling off screen (bounce)
                    if (godMode.current) {
                        const GROUND_Y_GAME = canvas.height - 20 * scale
                        if (birdY.current + scaledBirdSize > GROUND_Y_GAME) {
                            birdY.current = GROUND_Y_GAME - scaledBirdSize
                            birdVelocity.current = -Math.abs(birdVelocity.current) * 0.5
                        }
                        if (birdY.current < 0) {
                            birdY.current = 0
                            birdVelocity.current = Math.abs(birdVelocity.current) * 0.5
                        }
                    }

                    // === PILL ===
                    pillSpawnTimer.current++
                    if (!pill.current && pillSpawnTimer.current > 500 && Math.random() < 0.02 && pipes.current.length > 0 && greenPillsEnabled.current) {
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

                        // Green pill - just draw sprite (glow ring below provides effect)
                        if (greenPillSprite.current) {
                            const spriteSize = tabletRadius * 2.5
                            ctx.drawImage(greenPillSprite.current, px - spriteSize / 2, py - spriteSize / 2, spriteSize, spriteSize)
                        } else {
                            // Fallback circle
                            ctx.fillStyle = '#33cc33'
                            ctx.beginPath()
                            ctx.ellipse(px, py, tabletWidth, tabletHeight, 0, 0, Math.PI * 2)
                            ctx.fill()
                        }

                        // Glow ring
                        if (showBirdGlow.current) {
                            ctx.shadowColor = '#00ff00'
                            ctx.shadowBlur = 15 * scale
                        }
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
                            // Ultra: pill pickup particle burst
                            if (showBirdGlow.current) {
                                const burstCount = Math.round(18 * particleMultiplier.current)
                                for (let k = 0; k < burstCount; k++) {
                                    const angle = Math.random() * Math.PI * 2
                                    const speed = (2 + Math.random() * 5) * scale
                                    pillPickupParticles.current.push({
                                        x: px, y: py,
                                        vx: Math.cos(angle) * speed,
                                        vy: Math.sin(angle) * speed,
                                        life: 40 + Math.floor(Math.random() * 20),
                                        maxLife: 60,
                                        color: Math.random() > 0.5 ? '#00ff00' : '#44ff88',
                                        size: (3 + Math.random() * 4) * scale
                                    })
                                }
                            }
                        }

                        if (pill.current && pill.current.x < -50 * scale) {
                            pill.current = null
                        }
                    }

                    // === BLUE PILL (DEBUFF) ===
                    bluePillSpawnTimer.current++
                    if (!bluePill.current && bluePillSpawnTimer.current > 800 && Math.random() < 0.008 && pipes.current.length > 0 && bluePillsEnabled.current) {
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

                        // Blue pill - just draw sprite (glow ring below provides effect)
                        if (bluePillSprite.current) {
                            const spriteSize = bpRadius * 2.5
                            ctx.drawImage(bluePillSprite.current, bpx - spriteSize / 2, bpy - spriteSize / 2, spriteSize, spriteSize)
                        } else {
                            // Fallback circle
                            ctx.fillStyle = '#3333cc'
                            ctx.beginPath()
                            ctx.ellipse(bpx, bpy, bpWidth, bpHeight, 0, 0, Math.PI * 2)
                            ctx.fill()
                        }

                        // Glow ring
                        if (showBirdGlow.current) {
                            ctx.shadowColor = '#0088ff'
                            ctx.shadowBlur = 15 * scale
                        }
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
                            // Ultra: blue pill pickup particle burst
                            if (showBirdGlow.current) {
                                const burstCount = Math.round(18 * particleMultiplier.current)
                                for (let k = 0; k < burstCount; k++) {
                                    const angle = Math.random() * Math.PI * 2
                                    const speed = (2 + Math.random() * 5) * scale
                                    pillPickupParticles.current.push({
                                        x: bpx, y: bpy,
                                        vx: Math.cos(angle) * speed,
                                        vy: Math.sin(angle) * speed,
                                        life: 40 + Math.floor(Math.random() * 20),
                                        maxLife: 60,
                                        color: Math.random() > 0.5 ? '#0088ff' : '#44aaff',
                                        size: (3 + Math.random() * 4) * scale
                                    })
                                }
                            }
                        }

                        if (bluePill.current && bluePill.current.x < -50 * scale) {
                            bluePill.current = null
                        }
                    }

                    // Check blue pill expiry
                    if (bluePillActive.current && Date.now() > bluePillEndTime.current) {
                        bluePillActive.current = false
                    }

                    // === POSTER POWER-UP ===
                    posterSpawnTimer.current++
                    if (!poster.current && posterSpawnTimer.current > POSTER_SPAWN_INTERVAL && pipes.current.length > 0) {
                        const lastPipe = pipes.current[pipes.current.length - 1]
                        const gapCenter = lastPipe.topHeight + scaledPipeGap / 2
                        poster.current = { x: canvas.width + 30 * scale, y: gapCenter, rotation: 0 }
                        posterSpawnTimer.current = 0
                    }

                    if (poster.current) {
                        poster.current.x -= scaledPipeSpeed * 0.7
                        poster.current.rotation += 0.03
                        poster.current.y += Math.sin(globalTime * 0.08) * 0.8 * scale

                        const ppx = poster.current.x
                        const ppy = poster.current.y
                        const posterSize = 60 * scale

                        // Poster - just draw sprite (glow ring below provides effect)
                        if (posterSprite.current) {
                            ctx.save()
                            ctx.translate(ppx, ppy)
                            ctx.rotate(poster.current.rotation)
                            ctx.drawImage(posterSprite.current, -posterSize / 2, -posterSize / 2, posterSize, posterSize)
                            ctx.restore()
                        } else {
                            ctx.fillStyle = '#ff8800'
                            ctx.beginPath()
                            ctx.arc(ppx, ppy, posterSize / 2, 0, Math.PI * 2)
                            ctx.fill()
                        }

                        // Glow ring - no shadowBlur
                        ctx.strokeStyle = '#ffaa33'
                        ctx.lineWidth = 2 * scale
                        ctx.beginPath()
                        ctx.arc(ppx, ppy, posterSize / 2 + 5 * scale, 0, Math.PI * 2)
                        ctx.stroke()

                        // Collision detection
                        if (scaledBirdX < ppx + posterSize / 2 && scaledBirdX + scaledBirdSize > ppx - posterSize / 2 &&
                            birdY.current < ppy + posterSize / 2 && birdY.current + scaledBirdSize > ppy - posterSize / 2) {
                            posterActive.current = true
                            posterEndTime.current = Date.now() + POSTER_DURATION
                            powerUpActive.current = true  // Also enable shooting
                            powerUpEndTime.current = Date.now() + POSTER_DURATION
                            poster.current = null
                            playPillSound()
                            // Ultra: poster pickup particle burst
                            if (showBirdGlow.current) {
                                const burstCount = Math.round(22 * particleMultiplier.current)
                                for (let k = 0; k < burstCount; k++) {
                                    const angle = Math.random() * Math.PI * 2
                                    const speed = (2 + Math.random() * 6) * scale
                                    pillPickupParticles.current.push({
                                        x: ppx, y: ppy,
                                        vx: Math.cos(angle) * speed,
                                        vy: Math.sin(angle) * speed,
                                        life: 45 + Math.floor(Math.random() * 20),
                                        maxLife: 65,
                                        color: Math.random() > 0.5 ? '#ff8800' : '#ffcc44',
                                        size: (4 + Math.random() * 5) * scale
                                    })
                                }
                            }
                        }

                        if (poster.current && poster.current.x < -50 * scale) {
                            poster.current = null
                        }
                    }

                    // Poster expiry
                    if (posterActive.current && Date.now() > posterEndTime.current) {
                        posterActive.current = false
                    }

                    // Poster auto-fire stream
                    if (posterActive.current) {
                        posterAutoFireTimer.current++
                        if (posterAutoFireTimer.current % 5 === 0 && projectiles.current.length < 50) {
                            const angles = [-0.25, -0.12, 0, 0.12, 0.25]
                            for (const angle of angles) {
                                projectiles.current.push({
                                    x: scaledBirdX + scaledBirdSize,
                                    y: birdY.current + scaledBirdSize / 2,
                                    vy: Math.tan(angle) * 6 * scale
                                })
                            }
                        }
                    }

                    // === PROJECTILES ===
                    for (let i = projectiles.current.length - 1; i >= 0; i--) {
                        const proj = projectiles.current[i]
                        proj.x += 8 * scale
                        if (proj.vy) proj.y += proj.vy  // Spread shot vertical movement

                        // Manual glow: larger semi-transparent circle behind projectile
                        if (showGlow.current) {
                            ctx.globalAlpha = 0.3
                            ctx.fillStyle = '#ffffff'
                            ctx.beginPath()
                            ctx.arc(proj.x + 6 * scale, proj.y, 10 * scale, 0, Math.PI * 2)
                            ctx.fill()
                            // Ultra: extra outer glow ring
                            if (showBirdGlow.current) {
                                ctx.globalAlpha = 0.12
                                ctx.fillStyle = '#88ccff'
                                ctx.beginPath()
                                ctx.arc(proj.x + 4 * scale, proj.y, 18 * scale, 0, Math.PI * 2)
                                ctx.fill()
                            }
                            ctx.globalAlpha = 1
                        }
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

                        for (let j = pipes.current.length - 1; j >= 0; j--) {
                            const p = pipes.current[j]
                            if (!p.destroyed && proj.x + 15 * scale > p.x && proj.x < p.x + scaledPipeWidth) {
                                if (proj.y < p.topHeight) {
                                    p.destroyed = true
                                    projectiles.current[i] = projectiles.current[projectiles.current.length - 1]
                                    projectiles.current.pop()
                                    // Spawn explosion particles (capped, scaled by particle multiplier)
                                    const expBase = Math.round(15 * particleMultiplier.current)
                                    const expCap = Math.round(150 * particleMultiplier.current)
                                    const expCount = Math.min(expBase, expCap - explosionParticles.current.length)
                                    for (let k = 0; k < expCount; k++) {
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
                                    projectiles.current[i] = projectiles.current[projectiles.current.length - 1]
                                    projectiles.current.pop()
                                    // Spawn explosion particles (capped, scaled by particle multiplier)
                                    const expBase2 = Math.round(15 * particleMultiplier.current)
                                    const expCap2 = Math.round(150 * particleMultiplier.current)
                                    const expCount2 = Math.min(expBase2, expCap2 - explosionParticles.current.length)
                                    for (let k = 0; k < expCount2; k++) {
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
                            projectiles.current[i] = projectiles.current[projectiles.current.length - 1]
                            projectiles.current.pop()
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
                            explosionParticles.current[i] = explosionParticles.current[explosionParticles.current.length - 1]
                            explosionParticles.current.pop()
                        } else if (showParticles.current) {
                            // Manual glow: larger faded circle behind particle
                            if (showGlow.current) {
                                ctx.globalAlpha = p.life * 0.3
                                ctx.fillStyle = p.color
                                ctx.beginPath()
                                ctx.arc(p.x, p.y, p.size * p.life * 2.5, 0, Math.PI * 2)
                                ctx.fill()
                            }
                            ctx.globalAlpha = p.life
                            ctx.fillStyle = p.color
                            ctx.beginPath()
                            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
                            ctx.fill()
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

                                // Danger edge glow (manual - no shadowBlur, runs per pipe!)
                                const edgeY = isTop ? oy + oh : oy
                                if (showGlow.current) {
                                    ctx.globalAlpha = 0.25
                                    ctx.fillStyle = '#ff4400'
                                    ctx.fillRect(ox - 2 * scale, edgeY - (isTop ? 6 * scale : -3 * scale), ow + 4 * scale, 6 * scale)
                                    ctx.globalAlpha = 1
                                }
                                ctx.fillRect(ox, edgeY - (isTop ? 3 * scale : 0), ow, 3 * scale)
                            }

                            // Draw top obstacle
                            drawObstacleSegment(p.x, 0, scaledPipeWidth, p.topHeight, true, p.towerIndex || 0)
                            // Draw bottom obstacle  
                            const bottomY = p.topHeight + scaledPipeGap
                            const bottomH = canvas.height - bottomY - 20 * scale
                            drawObstacleSegment(p.x, bottomY, scaledPipeWidth, bottomH, false, p.towerIndex || 0)

                            if (scaledBirdX < p.x + scaledPipeWidth && scaledBirdX + scaledBirdSize > p.x &&
                                (birdY.current < p.topHeight || birdY.current + scaledBirdSize > p.topHeight + scaledPipeGap)) {
                                if (godMode.current) {
                                    // God mode: explode the building on touch
                                    p.destroyed = true
                                    const godExpCount = Math.round(20 * particleMultiplier.current)
                                    for (let k = 0; k < godExpCount; k++) {
                                        const angle = Math.random() * Math.PI * 2
                                        const speed = (3 + Math.random() * 6) * scale
                                        explosionParticles.current.push({
                                            x: p.x + scaledPipeWidth / 2,
                                            y: birdY.current,
                                            vx: Math.cos(angle) * speed,
                                            vy: Math.sin(angle) * speed,
                                            life: 1,
                                            size: (5 + Math.random() * 10) * scale,
                                            color: Math.random() > 0.5 ? '#ff8800' : '#ffcc00'
                                        })
                                    }
                                    playExplosionSound()
                                } else {
                                    setGameState('GAME_OVER')
                                }
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
                            pipes.current[i] = pipes.current[pipes.current.length - 1]
                            pipes.current.pop()
                        }
                    }

                    if (powerUpActive.current) {
                        const timeLeft = Math.ceil((powerUpEndTime.current - Date.now()) / 1000)
                        ctx.textAlign = 'left' // Move to Left (under Score)
                        ctx.fillStyle = '#00ff00'
                        ctx.font = `bold ${12 * scale}px sans-serif` // Smaller font
                        // Align below the Score counter (moved down 12px)
                        ctx.fillText(`⚡ POWER: ${timeLeft}s`, 20 * scale, 62 * scale)
                        ctx.font = `${10 * scale}px sans-serif`
                        ctx.fillText('(Jump to shoot!)', 20 * scale, 76 * scale)
                    }

                    // === WEATHER SYSTEM ===
                    const timeSinceStart = Date.now() - gameStartTime.current
                    const acidRainActive = timeSinceStart > ACID_RAIN_DELAY

                    // Pre-sandstorm transition: stop acid rain 5 pts before sandstorm
                    const preStormThreshold = SANDSTORM_TRIGGER_SCORE - 5

                    const isApproachingSandstorm = sandstormEnabled.current && score >= preStormThreshold && score < SANDSTORM_TRIGGER_SCORE && !sandstormActiveRef.current
                    const suppressRain = sandstormActiveRef.current || isApproachingSandstorm

                    if (acidRainActive && acidRainEnabled.current && !suppressRain) {
                        // Ultra: background rain layer (lower opacity, thinner, different speed)
                        if (showBirdGlow.current) {
                            if (Math.random() < 0.25 && bgRainDrops.current.length < 150) {
                                bgRainDrops.current.push({
                                    x: Math.random() * (canvas.width + 80),
                                    y: -20 - Math.random() * 50,
                                    speed: (3 + Math.random() * 2) * scale,
                                    length: (30 + Math.random() * 35) * scale,
                                    vx: -(0.5 + Math.random() * 0.3) * scale
                                })
                            }
                            // Update and draw background rain
                            for (let i = bgRainDrops.current.length - 1; i >= 0; i--) {
                                const drop = bgRainDrops.current[i]
                                drop.y += drop.speed
                                drop.x += drop.vx
                                ctx.globalAlpha = 0.12
                                ctx.strokeStyle = '#66cc00'
                                ctx.lineWidth = 3 * scale
                                ctx.beginPath()
                                ctx.moveTo(drop.x, drop.y)
                                ctx.lineTo(drop.x - drop.vx * 2.5, drop.y + drop.length)
                                ctx.stroke()
                                ctx.globalAlpha = 1
                                if (drop.y > canvas.height || drop.x < -60) {
                                    bgRainDrops.current[i] = bgRainDrops.current[bgRainDrops.current.length - 1]
                                    bgRainDrops.current.pop()
                                }
                            }
                        }

                        // Spawn new rain drops (slight diagonal for speed effect)
                        if (Math.random() < 0.3 * particleMultiplier.current && rainDrops.current.length < Math.round(200 * particleMultiplier.current)) {
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

                            // Draw acid rain drop with glow (wider faded stroke behind)
                            if (showWeatherFX.current) {
                                ctx.globalAlpha = 0.3
                                ctx.strokeStyle = '#88ff00'
                                ctx.lineWidth = 6 * scale
                                ctx.beginPath()
                                ctx.moveTo(drop.x, drop.y)
                                ctx.lineTo(drop.x - drop.vx * 2, drop.y + drop.length)
                                ctx.stroke()
                                ctx.globalAlpha = 1
                                ctx.lineWidth = 2 * scale
                                ctx.beginPath()
                                ctx.moveTo(drop.x, drop.y)
                                ctx.lineTo(drop.x - drop.vx * 2, drop.y + drop.length)
                                ctx.stroke()
                            }

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
                                rainDrops.current[i] = rainDrops.current[rainDrops.current.length - 1]
                                rainDrops.current.pop()
                                continue
                            }

                            // Remove drops that are off screen (left edge or bottom)
                            if (drop.y > canvas.height || drop.x < -50) {
                                rainDrops.current[i] = rainDrops.current[rainDrops.current.length - 1]
                                rainDrops.current.pop()
                            }
                        }

                        // Update and draw splash particles
                        for (let i = splashParticles.current.length - 1; i >= 0; i--) {
                            const p = splashParticles.current[i]
                            p.x += p.vx
                            p.y += p.vy
                            p.vy += 0.2 * scale
                            p.life--

                            // Manual glow: larger faded circle behind splash
                            ctx.globalAlpha = (p.life / 30) * 0.3
                            ctx.fillStyle = p.color
                            ctx.beginPath()
                            ctx.arc(p.x, p.y, 7 * scale, 0, Math.PI * 2)
                            ctx.fill()
                            ctx.globalAlpha = p.life / 30
                            ctx.beginPath()
                            ctx.arc(p.x, p.y, 3 * scale, 0, Math.PI * 2)
                            ctx.fill()
                            ctx.globalAlpha = 1

                            if (p.life <= 0) {
                                splashParticles.current[i] = splashParticles.current[splashParticles.current.length - 1]
                                splashParticles.current.pop()
                            }
                        }

                        // Acid rain warning text (Right-aligned below Level)
                        ctx.textAlign = 'right' // Move to Right (under Level)
                        ctx.fillStyle = '#88ff00'
                        ctx.font = `bold ${10 * scale}px sans-serif` // Smaller font
                        // Align below the Level counter (moved down 12px)
                        ctx.fillText('ACID RAIN', canvas.width - 20 * scale, 62 * scale)
                    }

                    // Ultra: update and draw pill pickup particles
                    if (pillPickupParticles.current.length > 0) {
                        for (let i = pillPickupParticles.current.length - 1; i >= 0; i--) {
                            const p = pillPickupParticles.current[i]
                            p.x += p.vx
                            p.y += p.vy
                            p.vy += 0.12 * scale // slight gravity
                            p.vx *= 0.98 // friction
                            p.life--
                            const alpha = Math.max(0, p.life / p.maxLife)
                            // Outer glow
                            ctx.globalAlpha = alpha * 0.25
                            ctx.fillStyle = p.color
                            ctx.beginPath()
                            ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2)
                            ctx.fill()
                            // Core
                            ctx.globalAlpha = alpha
                            ctx.beginPath()
                            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
                            ctx.fill()
                            ctx.globalAlpha = 1
                            if (p.life <= 0) {
                                pillPickupParticles.current[i] = pillPickupParticles.current[pillPickupParticles.current.length - 1]
                                pillPickupParticles.current.pop()
                            }
                        }
                    }

                    // Ultra: Spotlight system (every 35s, 1/5 chance)
                    if (showBirdGlow.current) {
                        const now = Date.now()
                        if (!spotlightActive.current) {
                            if (now - spotlightLastCheck.current > 35000) {
                                spotlightLastCheck.current = now
                                if (Math.random() < 0.2) {
                                    // Activate spotlight!
                                    spotlightActive.current = true
                                    spotlightStartTime.current = now
                                    // Start at random position on screen
                                    spotlightX.current = canvas.width * (0.2 + Math.random() * 0.6)
                                    spotlightY.current = canvas.height * (0.2 + Math.random() * 0.6)
                                    // Random wander velocity
                                    const wanderAngle = Math.random() * Math.PI * 2
                                    spotlightVx.current = Math.cos(wanderAngle) * 1.5 * scale
                                    spotlightVy.current = Math.sin(wanderAngle) * 1.2 * scale
                                    spotlightLockedOn.current = false
                                    spotlightLeftBehind.current = false
                                }
                            }
                        }

                        if (spotlightActive.current) {
                            const elapsed = now - spotlightStartTime.current

                            // Deactivate when scrolled off-screen
                            if (spotlightX.current < -100 * scale) {
                                spotlightActive.current = false
                            } else {
                                const fadeIn = Math.min(1, elapsed / 600)

                                const birdCenterX = scaledBirdX + scaledBirdSize / 2
                                const birdCenterY = birdY.current + scaledBirdSize / 2

                                // Phase 1: Wander (0 - 2.5s)
                                if (!spotlightLockedOn.current && elapsed > SPOTLIGHT_LOCK_DELAY) {
                                    spotlightLockedOn.current = true
                                    spotlightLockTime.current = now
                                }

                                // Phase 3: Left behind (after 4.5s)
                                if (spotlightLockedOn.current && !spotlightLeftBehind.current && elapsed > SPOTLIGHT_LEAVE_DELAY) {
                                    spotlightLeftBehind.current = true
                                }

                                if (spotlightLeftBehind.current) {
                                    // Scroll left with the camera (same speed as pipes)
                                    spotlightX.current -= scaledPipeSpeed
                                } else if (spotlightLockedOn.current) {
                                    // Smoothly lerp toward Dicky
                                    const lockProgress = Math.min(1, (now - spotlightLockTime.current) / 800)
                                    const lerp = 0.04 + lockProgress * 0.08
                                    spotlightX.current += (birdCenterX - spotlightX.current) * lerp
                                    spotlightY.current += (birdCenterY - spotlightY.current) * lerp
                                } else {
                                    // Wander around
                                    spotlightX.current += spotlightVx.current
                                    spotlightY.current += spotlightVy.current
                                    // Gentle direction changes
                                    spotlightVx.current += (Math.random() - 0.5) * 0.15 * scale
                                    spotlightVy.current += (Math.random() - 0.5) * 0.15 * scale
                                    // Keep in bounds
                                    if (spotlightX.current < canvas.width * 0.1) spotlightVx.current += 0.3 * scale
                                    if (spotlightX.current > canvas.width * 0.9) spotlightVx.current -= 0.3 * scale
                                    if (spotlightY.current < canvas.height * 0.1) spotlightVy.current += 0.3 * scale
                                    if (spotlightY.current > canvas.height * 0.9) spotlightVy.current -= 0.3 * scale
                                }

                                // Draw solid overexposure circle — additive blend brightens everything underneath
                                const radius = 85 * scale
                                ctx.save()
                                ctx.globalCompositeOperation = 'lighter'
                                ctx.globalAlpha = 0.28 * fadeIn
                                ctx.fillStyle = '#ffffff'
                                ctx.beginPath()
                                ctx.arc(spotlightX.current, spotlightY.current, radius, 0, Math.PI * 2)
                                ctx.fill()
                                ctx.globalAlpha = 1
                                ctx.restore()
                            }
                        }
                    }

                    // Still draw existing rain drops draining off during transition
                    if (suppressRain && rainDrops.current.length > 0) {
                        for (let i = rainDrops.current.length - 1; i >= 0; i--) {
                            const drop = rainDrops.current[i]
                            drop.y += drop.speed
                            drop.x += drop.vx
                            // Faded wider stroke for glow effect
                            ctx.globalAlpha = 0.3
                            ctx.strokeStyle = '#88ff00'
                            ctx.lineWidth = 6 * scale
                            ctx.beginPath()
                            ctx.moveTo(drop.x, drop.y)
                            ctx.lineTo(drop.x - drop.vx * 2, drop.y + drop.length)
                            ctx.stroke()
                            ctx.globalAlpha = 1
                            ctx.lineWidth = 2 * scale
                            ctx.beginPath()
                            ctx.moveTo(drop.x, drop.y)
                            ctx.lineTo(drop.x - drop.vx * 2, drop.y + drop.length)
                            ctx.stroke()
                            if (drop.y > canvas.height || drop.x < -50) {
                                rainDrops.current.splice(i, 1)
                            }
                        }
                    }

                    // Pre-sandstorm transition: gradual yellow overlay fade-in
                    if (isApproachingSandstorm) {
                        const transitionProgress = (score - preStormThreshold) / 5  // 0 to 1
                        ctx.fillStyle = `rgba(180, 140, 60, ${0.04 + transitionProgress * 0.12})`
                        ctx.fillRect(0, 0, canvas.width, canvas.height)

                        // A few early sand wisps
                        if (Math.random() < transitionProgress * 0.15) {
                            sandParticles.current.push({
                                x: -10 - Math.random() * 50,
                                y: Math.random() * canvas.height,
                                speed: (4 + Math.random() * 4) * scale,
                                size: (1 + Math.random() * 2) * scale,
                                opacity: 0.1 + Math.random() * 0.2
                            })
                        }
                        for (let i = sandParticles.current.length - 1; i >= 0; i--) {
                            const sand = sandParticles.current[i]
                            sand.x += sand.speed
                            sand.y += (Math.random() - 0.5) * scale
                            ctx.globalAlpha = sand.opacity
                            ctx.fillStyle = '#c4a84f'
                            ctx.beginPath()
                            ctx.ellipse(sand.x, sand.y, sand.size * 2, sand.size, 0, 0, Math.PI * 2)
                            ctx.fill()
                            ctx.globalAlpha = 1
                            if (sand.x > canvas.width + 50) {
                                sandParticles.current[i] = sandParticles.current[sandParticles.current.length - 1]
                                sandParticles.current.pop()
                            }
                        }

                        // Pulsing warning
                        const pulse = Math.sin(Date.now() * 0.005) * 0.3 + 0.7
                        ctx.globalAlpha = pulse
                        ctx.fillStyle = '#c4a84f'
                        ctx.font = `bold ${12 * scale}px sans-serif`
                        ctx.fillText('SANDSTORM INCOMING', canvas.width - 160 * scale, 30 * scale)
                        ctx.globalAlpha = 1
                    }

                    // === SANDSTORM WEATHER SYSTEM ===
                    // Trigger sandstorm at score multiples of 60
                    if (sandstormEnabled.current && score >= SANDSTORM_TRIGGER_SCORE && score % SANDSTORM_TRIGGER_SCORE === 0 && score !== lastSandstormScore.current) {
                        sandstormActiveRef.current = true
                        const stormDuration = score >= LEVEL_2_SCORE ? SANDSTORM_DURATION_LVL2 : SANDSTORM_DURATION_BASE
                        sandstormEndTime.current = Date.now() + stormDuration
                        lastSandstormScore.current = score
                    }
                    // Check if sandstorm has expired
                    if (sandstormActiveRef.current && Date.now() > sandstormEndTime.current) {
                        sandstormActiveRef.current = false
                        sandParticles.current = []
                    }

                    if (sandstormActiveRef.current) {
                        // Yellowish/mustard overlay
                        ctx.fillStyle = 'rgba(180, 140, 60, 0.15)'
                        ctx.fillRect(0, 0, canvas.width, canvas.height)

                        // Spawn new sand particles (horizontal wind)
                        if (Math.random() < 0.5 * particleMultiplier.current && sandParticles.current.length < Math.round(300 * particleMultiplier.current)) {
                            sandParticles.current.push({
                                x: -10 - Math.random() * 50,
                                y: Math.random() * canvas.height,
                                speed: (8 + Math.random() * 6) * scale,
                                size: (2 + Math.random() * 4) * scale,
                                opacity: 0.3 + Math.random() * 0.5
                            })
                        }

                        // Update and draw sand particles
                        for (let i = sandParticles.current.length - 1; i >= 0; i--) {
                            const sand = sandParticles.current[i]
                            sand.x += sand.speed
                            sand.y += (Math.random() - 0.5) * 2 * scale  // Slight vertical drift

                            // Draw sand particle as elongated streak (goo blown by wind)
                            if (showWeatherFX.current) {
                                ctx.globalAlpha = sand.opacity
                                // Manual glow: larger faded ellipse behind sand particle
                                ctx.fillStyle = '#d4b86f'
                                ctx.globalAlpha = sand.opacity * 0.3
                                ctx.beginPath()
                                ctx.ellipse(sand.x, sand.y, sand.size * 5, sand.size * 2, 0, 0, Math.PI * 2)
                                ctx.fill()
                                ctx.globalAlpha = sand.opacity
                                ctx.fillStyle = '#c4a84f'
                                ctx.beginPath()
                                ctx.ellipse(sand.x, sand.y, sand.size * 3, sand.size, 0, 0, Math.PI * 2)
                                ctx.fill()
                                ctx.globalAlpha = 1
                            }

                            // Remove particles that are off screen
                            if (sand.x > canvas.width + 50) {
                                sandParticles.current[i] = sandParticles.current[sandParticles.current.length - 1]
                                sandParticles.current.pop()
                            }
                        }

                        // Sandstorm active text with countdown
                        const sandTimeLeft = Math.ceil((sandstormEndTime.current - Date.now()) / 1000)
                        ctx.textAlign = 'right' // Move to Right (under Level)
                        ctx.fillStyle = '#c4a84f'
                        ctx.font = `bold ${10 * scale}px sans-serif` // Smaller font
                        // Align below Level counter (moved down 12px)
                        ctx.fillText(`SANDSTORM ${sandTimeLeft}s`, canvas.width - 20 * scale, 62 * scale)
                    }

                    // === VILLAIN TAUNT SYSTEM ===
                    // Trigger a new taunt every 10 score points (skip during boss intro)
                    if (score > 0 && score % 10 === 0 && score !== lastTauntScore.current && !bossIntroActive.current) {
                        currentTaunt.current = TAUNT_MESSAGES[Math.floor(Math.random() * TAUNT_MESSAGES.length)]
                        currentVillainIndex.current = Math.floor(Math.random() * VILLAIN_PATHS.length) // Pick random villain!
                        tauntEndTime.current = Date.now() + 3000 // Show for 3 seconds
                        lastTauntScore.current = score
                    }

                    // Draw taunt popup if active (hide during boss intro)
                    if (currentTaunt.current && Date.now() < tauntEndTime.current && !bossIntroActive.current) {
                        const tauntAlpha = Math.min(1, (tauntEndTime.current - Date.now()) / 500) // Fade out
                        ctx.globalAlpha = tauntAlpha

                        // Draw villain face in bottom-left corner
                        const faceSize = 80 * scale
                        const faceX = 15 * scale
                        const faceY = canvas.height - faceSize - 60 * scale

                        ctx.strokeStyle = '#ff0066'
                        ctx.lineWidth = 3 * scale
                        ctx.strokeRect(faceX, faceY, faceSize, faceSize)

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
                        ctx.font = `bold ${11 * scale}px sans-serif`
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
                        ctx.globalAlpha = 1
                    } else if (Date.now() >= tauntEndTime.current) {
                        currentTaunt.current = null
                    }

                    // === PHASE 2 BOSS INTRO ===
                    if (score >= LEVEL_2_SCORE && !bossIntroTriggered.current) {
                        bossIntroTriggered.current = true
                        bossIntroActive.current = true
                        bossIntroStartTime.current = Date.now()
                        bossMessageIndex.current = 0
                        bossCharIndex.current = 0
                        bossLastCharTime.current = Date.now() + BOSS_GLITCH_DURATION // Start typing after glitch
                    }

                    if (bossIntroActive.current) {
                        const elapsed = Date.now() - bossIntroStartTime.current
                        const isGlitching = elapsed < BOSS_GLITCH_DURATION
                        const faceSize = 90 * scale
                        const faceX = 15 * scale
                        const faceY = canvas.height - faceSize - 70 * scale

                        ctx.save()

                        if (isGlitching) {
                            // === CYBERPUNK GLITCH EFFECT ===
                            const glitchIntensity = 1 - (elapsed / BOSS_GLITCH_DURATION) * 0.7
                            const t = Date.now()

                            // Screen flash
                            if (Math.random() < 0.1 * glitchIntensity) {
                                ctx.fillStyle = `rgba(255, 255, 0, ${0.05 * glitchIntensity})`
                                ctx.fillRect(0, 0, canvas.width, canvas.height)
                            }

                            // Glitch scanlines
                            for (let sl = 0; sl < 5; sl++) {
                                if (Math.random() < 0.3 * glitchIntensity) {
                                    const slY = faceY + Math.random() * faceSize
                                    const slH = (1 + Math.random() * 3) * scale
                                    ctx.fillStyle = `rgba(255, 255, 0, ${0.3 * glitchIntensity})`
                                    ctx.fillRect(faceX - 5 * scale, slY, faceSize + 10 * scale, slH)
                                }
                            }

                            // Neon yellow border with glitch
                            ctx.shadowColor = '#ffff00'
                            ctx.shadowBlur = (15 + Math.sin(t * 0.02) * 10) * scale * glitchIntensity
                            ctx.strokeStyle = '#ffff00'
                            ctx.lineWidth = 3 * scale
                            const offsetX = (Math.random() - 0.5) * 8 * scale * glitchIntensity
                            const offsetY = (Math.random() - 0.5) * 8 * scale * glitchIntensity
                            ctx.strokeRect(faceX + offsetX, faceY + offsetY, faceSize, faceSize)
                            ctx.shadowBlur = 0

                            // Draw boss with RGB split glitch
                            if (bossSprite.current) {
                                // Red channel offset
                                ctx.globalCompositeOperation = 'lighter'
                                ctx.globalAlpha = 0.6
                                const rgbOff = 4 * scale * glitchIntensity
                                ctx.drawImage(bossSprite.current, faceX - rgbOff + offsetX, faceY + offsetY, faceSize, faceSize)
                                ctx.globalCompositeOperation = 'source-over'
                                ctx.globalAlpha = 0.8 + Math.random() * 0.2
                                ctx.drawImage(bossSprite.current, faceX + offsetX, faceY + offsetY, faceSize, faceSize)
                                ctx.globalAlpha = 1
                            }

                            // Glitch text flicker
                            if (Math.random() < 0.4) {
                                ctx.fillStyle = '#ffff00'
                                ctx.shadowColor = '#ffff00'
                                ctx.shadowBlur = 10 * scale
                                ctx.font = `bold ${14 * scale}px sans-serif`
                                ctx.textAlign = 'left'
                                const glitchTexts = ['INCOMING SIGNAL...', 'DECRYPTING...', '???', 'UNKNOWN ENTITY', 'WARNING']
                                ctx.fillText(glitchTexts[Math.floor(Math.random() * glitchTexts.length)], faceX + faceSize + 15 * scale, faceY + 30 * scale)
                                ctx.shadowBlur = 0
                            }
                        } else {
                            // === STABILIZED - Sequential messages ===
                            // Neon yellow border (stable)
                            ctx.shadowColor = '#ffff00'
                            ctx.shadowBlur = 12 * scale
                            ctx.strokeStyle = '#ffff00'
                            ctx.lineWidth = 3 * scale
                            ctx.strokeRect(faceX, faceY, faceSize, faceSize)
                            ctx.shadowBlur = 0

                            // Draw boss face (stable)
                            if (bossSprite.current) {
                                ctx.drawImage(bossSprite.current, faceX, faceY, faceSize, faceSize)
                            }

                            // Typewriter text system
                            const now = Date.now()
                            if (bossMessageIndex.current < BOSS_MESSAGES.length) {
                                const currentMsg = BOSS_MESSAGES[bossMessageIndex.current]

                                // Advance character
                                if (bossCharIndex.current < currentMsg.length && now - bossLastCharTime.current > BOSS_MESSAGE_CHAR_SPEED) {
                                    bossCharIndex.current++
                                    bossLastCharTime.current = now
                                }

                                // Move to next message after pause
                                if (bossCharIndex.current >= currentMsg.length && now - bossLastCharTime.current > BOSS_MESSAGE_PAUSE) {
                                    bossMessageIndex.current++
                                    bossCharIndex.current = 0
                                    bossLastCharTime.current = now
                                }

                                // Draw speech bubble
                                const bubbleX = faceX + faceSize + 12 * scale
                                const bubbleY = faceY
                                const bubbleWidth = Math.min(220 * scale, canvas.width - bubbleX - 20 * scale)
                                const bubbleHeight = 60 * scale

                                ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
                                ctx.strokeStyle = '#ffff00'
                                ctx.lineWidth = 2 * scale
                                ctx.beginPath()
                                ctx.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 8 * scale)
                                ctx.fill()
                                ctx.stroke()

                                // Bubble pointer
                                ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
                                ctx.beginPath()
                                ctx.moveTo(bubbleX, bubbleY + 15 * scale)
                                ctx.lineTo(bubbleX - 10 * scale, bubbleY + 25 * scale)
                                ctx.lineTo(bubbleX, bubbleY + 35 * scale)
                                ctx.fill()

                                // Draw current text with typewriter
                                const displayText = currentMsg.substring(0, bossCharIndex.current)
                                ctx.fillStyle = '#ffff00'
                                ctx.shadowColor = '#ffff00'
                                ctx.shadowBlur = 5 * scale
                                ctx.font = `bold ${11 * scale}px sans-serif`
                                ctx.textAlign = 'left'

                                // Word wrap
                                const words = displayText.split(' ')
                                let line = ''
                                let ty = bubbleY + 20 * scale
                                for (const word of words) {
                                    const testLine = line + word + ' '
                                    if (ctx.measureText(testLine).width > bubbleWidth - 20 * scale) {
                                        ctx.fillText(line.trim(), bubbleX + 10 * scale, ty)
                                        line = word + ' '
                                        ty += 15 * scale
                                    } else {
                                        line = testLine
                                    }
                                }
                                ctx.fillText(line.trim(), bubbleX + 10 * scale, ty)

                                // Blinking cursor
                                if (bossCharIndex.current < currentMsg.length && Math.floor(now / 300) % 2 === 0) {
                                    const cursorX = bubbleX + 10 * scale + ctx.measureText(line.trim()).width + 2 * scale
                                    ctx.fillRect(cursorX, ty - 10 * scale, 2 * scale, 12 * scale)
                                }
                                ctx.shadowBlur = 0
                            } else {
                                // All messages done - fade out
                                const fadeStart = bossLastCharTime.current
                                const fadeProgress = (now - fadeStart) / 1500
                                if (fadeProgress >= 1) {
                                    bossIntroActive.current = false
                                }
                            }
                        }

                        ctx.restore()
                        ctx.globalAlpha = 1
                    }

                    if (birdY.current + scaledBirdSize >= canvas.height - 20 * scale || birdY.current < 0) {
                        if (!godMode.current) {
                            setGameState('GAME_OVER')
                        }
                    }


                } else if (gameState === 'START') {
                    // Draw Background Image if loaded, otherwise dark fills
                    // Draw Logo
                    if (logoSprite.current) {
                        const logoW = Math.min(600 * scale, canvas.width * 0.8)
                        const logoH = logoW * (logoSprite.current.height / logoSprite.current.width)
                        const logoX = centerX - logoW / 2
                        const logoY = canvas.height * 0.1 // Higher up (Top 10%)

                        // Shadow for pop
                        ctx.shadowColor = '#00ffff'
                        ctx.shadowBlur = 20 * scale
                        ctx.drawImage(logoSprite.current, logoX, logoY, logoW, logoH)
                        ctx.shadowBlur = 0
                    }

                    const active = mouseMenuItem.current >= 0 ? mouseMenuItem.current : selectedMenuItem.current

                    if (menuScreen === 'MAIN') {
                        // === MAIN MENU (RETRO PIXEL STYLE) ===
                        const menuY = canvas.height * 0.6
                        const itemH = 30 * scale // Smaller height for tighter packing
                        const gap = 24 * scale   // Exact 24px gap named as requested (scaled)

                        ctx.font = `${24 * scale}px "Press Start 2P", monospace`; // Pixel font
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";

                        for (let i = 0; i < MENU_ITEMS_MAIN.length; i++) {
                            const y = menuY + i * (itemH + gap)
                            const isActive = i === active
                            const label = MENU_ITEMS_MAIN[i]

                            // Text Color: Teal Neon if active (with arrow), White if inactive
                            const tealNeon = '#00ffff';
                            ctx.fillStyle = isActive ? tealNeon : '#ffffff';

                            if (isActive) {
                                ctx.shadowColor = tealNeon;
                                ctx.shadowBlur = 10 * scale;
                            } else {
                                ctx.shadowBlur = 0;
                            }

                            // Draw Text
                            ctx.fillText(label, centerX, y);
                            ctx.shadowBlur = 0; // Reset shadow

                            // Draw Teal Neon Pixel Arrow Cursor if active
                            if (isActive) {
                                const arrowSize = 20 * scale;
                                const arrowX = centerX - 140 * scale; // To the left of text
                                const arrowY = y;

                                ctx.fillStyle = tealNeon; // Teal Neon
                                ctx.shadowColor = tealNeon;
                                ctx.shadowBlur = 10 * scale;

                                ctx.beginPath();
                                // Pixel-style arrow (triangle)
                                ctx.moveTo(arrowX, arrowY - arrowSize / 2);
                                ctx.lineTo(arrowX + arrowSize, arrowY);
                                ctx.lineTo(arrowX, arrowY + arrowSize / 2);
                                ctx.fill();
                                ctx.shadowBlur = 0;
                            }
                        }

                        // Navigation hint (Restored)
                        ctx.fillStyle = '#888'
                        ctx.font = `${10 * scale}px sans-serif`
                        ctx.textAlign = 'center'
                        ctx.fillText('ver 0.2.1 • Pixel Imperfect', centerX, canvas.height - 40 * scale)

                    } else if (menuScreen === 'OPTIONS') {
                        // === OPTIONS SCREEN ===
                        const panelW = 320 * scale
                        const panelH = 400 * scale
                        const panelX = centerX - panelW / 2
                        const panelY = canvas.height / 2 - panelH / 2

                        // Panel background (Holographic)
                        const panelGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH)
                        panelGrad.addColorStop(0, 'rgba(10, 20, 40, 0.95)')
                        panelGrad.addColorStop(1, 'rgba(5, 10, 20, 0.95)')
                        ctx.fillStyle = panelGrad

                        ctx.beginPath()
                        ctx.roundRect(panelX, panelY, panelW, panelH, 10 * scale)
                        ctx.fill()

                        // Border with Glow
                        ctx.shadowColor = '#00ffff'
                        ctx.shadowBlur = 10 * scale
                        ctx.strokeStyle = '#00ffff'
                        ctx.lineWidth = 2 * scale
                        ctx.stroke()
                        ctx.shadowBlur = 0

                        // === TABS ===
                        const tabW = panelW / 2
                        const tabH = 40 * scale

                        TABS.forEach((tab, idx) => {
                            const tabX = panelX + idx * tabW
                            const isActiveTab = activeTab === tab

                            // Tab Background
                            ctx.fillStyle = isActiveTab ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.5)'
                            if (isActiveTab) {
                                ctx.shadowColor = '#00ffff'
                                ctx.shadowBlur = 15 * scale
                            }
                            ctx.beginPath()
                            // Round top corners only
                            ctx.roundRect(tabX, panelY, tabW, tabH, [10 * scale, 10 * scale, 0, 0])
                            ctx.fill()
                            ctx.shadowBlur = 0

                            // Tab Text
                            ctx.fillStyle = isActiveTab ? '#ffffff' : '#8899aa'
                            ctx.font = `bold ${14 * scale}px sans-serif`
                            ctx.textAlign = 'center'
                            ctx.fillText(tab, tabX + tabW / 2, panelY + 25 * scale)

                            // Selection Line
                            if (isActiveTab) {
                                ctx.fillStyle = '#00ffff'
                                ctx.fillRect(tabX, panelY + tabH - 2 * scale, tabW, 2 * scale)
                            }
                        })

                        // === CONTENT ===
                        const contentStartY = panelY + 60 * scale
                        const itemH = 30 * scale
                        const currentItems = activeTab === 'GRAPHICS' ? GRAPHICS_ITEMS : AUDIO_ITEMS

                        for (let i = 0; i < currentItems.length; i++) {
                            const y = contentStartY + i * itemH
                            const isActive = i === selectedMenuItem.current
                            const item = currentItems[i]

                            // Selection highlight
                            if (isActive) {
                                ctx.fillStyle = 'rgba(0, 255, 255, 0.1)'
                                ctx.fillRect(panelX + 10 * scale, y - 10 * scale, panelW - 20 * scale, 24 * scale)

                                // Selection Indicator
                                ctx.fillStyle = '#00ffff'
                                ctx.beginPath()
                                ctx.moveTo(panelX + 10 * scale, y + 2 * scale)
                                ctx.lineTo(panelX + 16 * scale, y - 4 * scale)
                                ctx.lineTo(panelX + 16 * scale, y + 8 * scale)
                                ctx.fill()
                            }

                            if (activeTab === 'GRAPHICS') {
                                if (item === 'QUALITY') {
                                    ctx.textAlign = 'left'
                                    ctx.fillStyle = isActive ? '#00ffff' : '#888'
                                    ctx.font = `bold ${12 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText('Quality:', panelX + 30 * scale, y + 4 * scale)

                                    ctx.textAlign = 'right'
                                    const qColor = graphicsQuality === 'ULTRA' ? '#ffd700' : graphicsQuality === 'HIGH' ? '#00ff88' : graphicsQuality === 'MEDIUM' ? '#ffaa00' : graphicsQuality === 'CUSTOM' ? '#ff00ff' : '#ff4444'
                                    ctx.fillStyle = qColor
                                    ctx.font = `bold ${10 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText(`◀ ${graphicsQuality} ▶`, panelX + panelW - 20 * scale, y + 4 * scale)
                                } else if (item === 'RESOLUTION') {
                                    ctx.textAlign = 'left'
                                    ctx.fillStyle = isActive ? '#00ffff' : '#888'
                                    ctx.font = `bold ${12 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText('Resolution:', panelX + 30 * scale, y + 4 * scale)

                                    ctx.textAlign = 'right'
                                    ctx.fillStyle = '#fff'
                                    ctx.font = `bold ${10 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText(`◀ ${resolution} ▶`, panelX + panelW - 20 * scale, y + 4 * scale)
                                } else if (item === 'BACK') {
                                    ctx.textAlign = 'center'
                                    ctx.fillStyle = isActive ? '#ff0066' : '#666'
                                    ctx.font = `bold ${12 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText('← BACK', centerX, y + 4 * scale)
                                } else {
                                    // Toggles
                                    const isOn = getOptionValue(item)
                                    ctx.textAlign = 'left'
                                    ctx.fillStyle = isActive ? '#fff' : '#999'
                                    ctx.font = `${10 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText(item, panelX + 30 * scale, y + 4 * scale)

                                    ctx.textAlign = 'right'
                                    ctx.fillStyle = isOn ? '#00ff88' : '#ff4444'
                                    ctx.font = `bold ${10 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText(isOn ? 'ON' : 'OFF', panelX + panelW - 20 * scale, y + 4 * scale)
                                }
                            } else if (activeTab === 'AUDIO') {
                                if (item === 'BACK') {
                                    ctx.textAlign = 'center'
                                    ctx.fillStyle = isActive ? '#ff0066' : '#666'
                                    ctx.font = `bold ${12 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText('← BACK', centerX, y + 4 * scale)
                                } else {
                                    // Volume Sliders
                                    ctx.textAlign = 'left'
                                    ctx.fillStyle = isActive ? '#00ffff' : '#888'
                                    ctx.font = `bold ${10 * scale}px "Press Start 2P", monospace`
                                    ctx.fillText(item, panelX + 30 * scale, y + 4 * scale)

                                    // Slider Bar
                                    const sliderW = 100 * scale
                                    const sliderH = 6 * scale
                                    const sliderX = panelX + panelW - sliderW - 20 * scale
                                    const sliderY = y - 2 * scale

                                    // Track
                                    ctx.fillStyle = '#333'
                                    ctx.fillRect(sliderX, sliderY, sliderW, sliderH)

                                    // Fill
                                    const val = (item === 'Master Volume' || item === 'Music Volume') ? volume : 1
                                    ctx.fillStyle = isActive ? '#00ffff' : '#008888'
                                    ctx.fillRect(sliderX, sliderY, sliderW * val, sliderH)

                                    // Knob
                                    ctx.fillStyle = '#fff'
                                    ctx.fillRect(sliderX + sliderW * val - 2 * scale, sliderY - 2 * scale, 4 * scale, 10 * scale)
                                }
                            }
                        }

                        // Navigation Hint
                        ctx.textAlign = 'center'
                        ctx.fillStyle = '#555'
                        ctx.font = `${8 * scale}px "Press Start 2P", monospace`
                        ctx.fillText('Q/E Switch Tabs • Arrows Navigate • Esc Back', centerX, panelY + panelH - 10 * scale)
                    }
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
                    ctx.textAlign = 'center'
                    ctx.font = `bold ${36 * scale}px "Press Start 2P", monospace`
                    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2)
                    ctx.shadowBlur = 0

                    ctx.fillStyle = 'white'
                    ctx.font = `${12 * scale}px "Press Start 2P", monospace`
                    ctx.textAlign = 'center'
                    ctx.fillText('Press ESC or ENTER to resume', canvas.width / 2, canvas.height / 2 + 40 * scale)
                } else if (gameState === 'TITLE') {
                    // === ATTRACT MODE TITLE SCREEN ===
                    // Draw Logo
                    if (logoSprite.current) {
                        const logoW = Math.min(600 * scale, canvas.width * 0.9)
                        const logoH = logoW * (logoSprite.current.height / logoSprite.current.width)
                        const logoX = centerX - logoW / 2
                        // Float logo gently
                        const hoverY = Math.sin(globalTime * 0.05) * 10 * scale
                        const logoY = canvas.height * 0.2 + hoverY

                        ctx.shadowColor = '#00ffff'
                        ctx.shadowBlur = 20 * scale
                        ctx.drawImage(logoSprite.current, logoX, logoY, logoW, logoH)
                        ctx.shadowBlur = 0
                    }

                    // Blinking "PRESS START" - WITH PIXEL FONT
                    if (Math.floor(Date.now() / 800) % 2 === 0) {
                        ctx.fillStyle = '#00ffff'
                        ctx.font = `${24 * scale}px "Press Start 2P", monospace`
                        ctx.textAlign = 'center'
                        ctx.shadowColor = '#00ffff'
                        ctx.shadowBlur = 10 * scale
                        ctx.fillText('PRESS START', centerX, canvas.height * 0.7)
                        ctx.shadowBlur = 0
                        ctx.shadowBlur = 0
                    }

                    // Version text on TITLE screen too
                    ctx.fillStyle = '#888'
                    ctx.font = `${10 * scale}px sans-serif`
                    ctx.textAlign = 'center'
                    ctx.fillText('ver 0.2.1 • Pixel Imperfect', centerX, canvas.height - 40 * scale)

                    // Lore text at bottom - REMOVED

                    // Lore text removed

                } else if (gameState === 'GAME_OVER') {
                    // Save score once on game over
                    if (!scoreSaved.current) {
                        scoreSaved.current = true
                        const updated = saveHighScore(score)
                        setHighScores(updated)
                    }

                    // Dark overlay
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
                    ctx.fillRect(0, 0, canvas.width, canvas.height)

                    const centerX = canvas.width / 2
                    const panelW = 260 * scale
                    const panelH = 380 * scale
                    const panelX = centerX - panelW / 2
                    const panelY = canvas.height / 2 - panelH / 2 - 10 * scale

                    // Panel background
                    ctx.fillStyle = 'rgba(10, 10, 25, 0.95)'
                    ctx.strokeStyle = '#ff00ff'
                    ctx.lineWidth = 2 * scale
                    ctx.beginPath()
                    ctx.roundRect(panelX, panelY, panelW, panelH, 12 * scale)
                    ctx.fill()
                    ctx.stroke()

                    // Glow border
                    ctx.shadowColor = '#ff00ff'
                    ctx.shadowBlur = 15 * scale
                    ctx.beginPath()
                    ctx.roundRect(panelX, panelY, panelW, panelH, 12 * scale)
                    ctx.stroke()
                    ctx.shadowBlur = 0

                    // GAME OVER title
                    ctx.fillStyle = '#ff0066'
                    ctx.shadowColor = '#ff0066'
                    ctx.shadowBlur = 10 * scale
                    ctx.font = `bold ${28 * scale}px sans-serif`
                    ctx.textAlign = 'center'
                    ctx.fillText('GAME OVER', centerX, panelY + 35 * scale)
                    ctx.shadowBlur = 0

                    // Current score
                    ctx.fillStyle = '#00ffff'
                    ctx.shadowColor = '#00ffff'
                    ctx.shadowBlur = 8 * scale
                    ctx.font = `bold ${20 * scale}px sans-serif`
                    ctx.fillText(`SCORE: ${score}`, centerX, panelY + 65 * scale)
                    ctx.shadowBlur = 0

                    // Divider
                    ctx.strokeStyle = 'rgba(255, 0, 255, 0.3)'
                    ctx.lineWidth = 1 * scale
                    ctx.beginPath()
                    ctx.moveTo(panelX + 20 * scale, panelY + 80 * scale)
                    ctx.lineTo(panelX + panelW - 20 * scale, panelY + 80 * scale)
                    ctx.stroke()

                    // HIGH SCORES header
                    ctx.fillStyle = '#ff00ff'
                    ctx.textAlign = 'center'
                    ctx.font = `bold ${12 * scale}px "Press Start 2P", monospace`
                    ctx.fillText('TOP 10 HIGH SCORES', centerX, panelY + 100 * scale)

                    // Score list
                    const listTop = panelY + 120 * scale
                    const lineH = 22 * scale
                    const scores = highScores
                    for (let i = 0; i < MAX_HIGH_SCORES; i++) {
                        const y = listTop + i * lineH
                        const s = scores[i]
                        const rank = `${i + 1}.`
                        const isCurrentScore = s === score && i === scores.indexOf(score)

                        if (s !== undefined) {
                            // Highlight if this is the current score
                            if (isCurrentScore) {
                                ctx.fillStyle = 'rgba(0, 255, 255, 0.1)'
                                ctx.beginPath()
                                ctx.roundRect(panelX + 15 * scale, y - 12 * scale, panelW - 30 * scale, lineH, 4 * scale)
                                ctx.fill()
                                ctx.fillStyle = '#00ffff'
                                ctx.font = `bold ${10 * scale}px "Press Start 2P", monospace`
                            } else {
                                ctx.fillStyle = i < 3 ? '#ffd700' : '#888'
                                ctx.font = `${10 * scale}px "Press Start 2P", monospace`
                            }

                            ctx.textAlign = 'left'
                            ctx.fillText(rank, panelX + 25 * scale, y)
                            ctx.textAlign = 'right'
                            ctx.fillText(`${s}`, panelX + panelW - 25 * scale, y)
                        } else {
                            ctx.fillStyle = '#333'
                            ctx.font = `${10 * scale}px "Press Start 2P", monospace`
                            ctx.textAlign = 'left'
                            ctx.fillText(rank, panelX + 25 * scale, y)
                            ctx.textAlign = 'right'
                            ctx.fillText('---', panelX + panelW - 25 * scale, y)
                        }
                    }

                    // Restart prompt
                    ctx.textAlign = 'center'
                    ctx.fillStyle = '#aaa'
                    ctx.font = `${10 * scale}px "Press Start 2P", monospace`
                    ctx.fillText('Press Space to Restart', centerX, panelY + panelH - 15 * scale)
                }

                // Draw HUD (Score & Level) - Canvas based to avoid clipping/scaling issues
                if (gameState === 'PLAYING' || gameState === 'GAME_OVER' || gameState === 'PAUSED') {
                    const uiColor = score >= LEVEL_2_SCORE ? '#ffff00' : '#00ffff'
                    ctx.shadowColor = uiColor
                    ctx.shadowBlur = 10 * scale
                    ctx.fillStyle = uiColor
                    ctx.font = `${24 * scale}px "Press Start 2P", monospace`
                    ctx.textAlign = 'left'
                    ctx.textBaseline = 'top'
                    ctx.fillText(`${score}`, 20 * scale, 20 * scale)

                    ctx.textAlign = 'right'
                    ctx.font = `${16 * scale}px "Press Start 2P", monospace`
                    ctx.fillText(`LVL ${songLevel.current}`, canvas.width - 20 * scale, 20 * scale)

                    ctx.shadowBlur = 0
                    ctx.textBaseline = 'alphabetic' // Reset
                }
            } catch (e) {
                console.error("Render Loop Error:", e);
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) {
                    ctx.save();
                    ctx.fillStyle = 'red';
                    ctx.font = '20px sans-serif';
                    ctx.fillText('Render Error: ' + String(e).slice(0, 30), 50, 50);
                    ctx.restore();
                }
            }
            animationFrameId.current = requestAnimationFrame(render)
        }

        render()

        return () => {
            cancelAnimationFrame(animationFrameId.current)
        }
    }, [gameState, score, canvasSize, menuScreen, graphicsQuality])

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
                onMouseMove={(e) => {
                    if (gameState !== 'START') { mouseMenuItem.current = -1; return }
                    const rect = canvasRef.current?.getBoundingClientRect()
                    if (!rect) return
                    const scaleX = canvasSize.width / rect.width
                    const scaleY = canvasSize.height / rect.height
                    const mx = (e.clientX - rect.left) * scaleX
                    const my = (e.clientY - rect.top) * scaleY
                    mousePos.current = { x: mx, y: my }
                    const s = canvasSize.height / 600

                    if (menuScreen === 'MAIN') {
                        const menuY = canvasSize.height * 0.55
                        const btnW = 200 * s
                        const btnH = 50 * s
                        const gap = 20 * s
                        let found = -1

                        for (let i = 0; i < MENU_ITEMS_MAIN.length; i++) {
                            const y = menuY + i * (btnH + gap)
                            // Use exact same geometry as render function
                            if (my >= y && my <= y + btnH &&
                                mx >= canvasSize.width / 2 - btnW / 2 && mx <= canvasSize.width / 2 + btnW / 2) {
                                found = i; break
                            }
                        }
                        mouseMenuItem.current = found
                    } else if (menuScreen === 'OPTIONS') {
                        const panelW = 320 * s
                        const panelX = canvasSize.width / 2 - panelW / 2
                        const panelY = canvasSize.height / 2 - 200 * s // panelH is 400
                        const itemStartY = panelY + 60 * s
                        const itemH = 30 * s
                        let found = -1

                        const currentItems = activeTab === 'GRAPHICS' ? GRAPHICS_ITEMS : AUDIO_ITEMS

                        for (let i = 0; i < currentItems.length; i++) {
                            const y = itemStartY + i * itemH
                            if (my >= y - 10 * s && my <= y + 14 * s && mx >= panelX + 10 * s && mx <= panelX + panelW - 10 * s) {
                                found = i; break
                            }
                        }
                        mouseMenuItem.current = found
                    }
                }}
                onMouseLeave={() => { mouseMenuItem.current = -1 }}
                width={canvasSize.width}
                height={canvasSize.height}
                style={{
                    border: isFullscreen ? 'none' : `2px solid ${score >= LEVEL_2_SCORE ? '#ffff00' : '#00ffff'}`,
                    borderRadius: isFullscreen ? '0' : '8px',
                    boxShadow: isFullscreen ? 'none' : `0 0 30px ${score >= LEVEL_2_SCORE ? 'rgba(255, 255, 0, 0.3)' : 'rgba(0, 255, 255, 0.3)'}`
                }}
            />

            <button
                onClick={toggleMute}
                style={{
                    position: 'absolute',
                    top: 20,
                    right: 20,
                    background: `rgba(${score >= LEVEL_2_SCORE ? '255, 255, 0' : '0, 255, 255'}, 0.1)`,
                    border: `2px solid ${score >= LEVEL_2_SCORE ? '#ffff00' : '#00ffff'}`,
                    borderRadius: '50%',
                    width: 44,
                    height: 44,
                    cursor: 'pointer',
                    fontSize: '20px',
                    fontFamily: 'sans-serif',
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
            {/* Dev Mode Panel */}
            {devModeOpen && (
                <div style={{
                    position: 'absolute',
                    top: 80,
                    right: 20,
                    background: 'rgba(0, 0, 0, 0.9)',
                    border: '2px solid #ff00ff',
                    borderRadius: 12,
                    padding: 15,
                    color: '#fff',
                    fontSize: 13,
                    minWidth: 200,
                    maxHeight: 'calc(100vh - 120px)',
                    overflowY: 'auto',
                    boxShadow: '0 0 20px rgba(255, 0, 255, 0.3)',
                    zIndex: 100
                }}>
                    <div style={{ color: '#ff00ff', fontWeight: 'bold', marginBottom: 10, fontSize: 15 }}>
                        🛠️ DEV MODE
                    </div>

                    {/* === GAMEPLAY === */}
                    <div style={{ color: '#ff00ff88', fontSize: 10, fontWeight: 'bold', marginBottom: 6, letterSpacing: 1 }}>GAMEPLAY</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={greenPillsEnabled.current} onChange={() => { greenPillsEnabled.current = !greenPillsEnabled.current }} style={{ width: 16, height: 16, accentColor: '#00ff00' }} />
                            <span style={{ color: '#00ff00' }}>💊 Green Pills</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={bluePillsEnabled.current} onChange={() => { bluePillsEnabled.current = !bluePillsEnabled.current }} style={{ width: 16, height: 16, accentColor: '#4488ff' }} />
                            <span style={{ color: '#4488ff' }}>💊 Blue Pills</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={acidRainEnabled.current} onChange={() => { acidRainEnabled.current = !acidRainEnabled.current }} style={{ width: 16, height: 16, accentColor: '#88ff00' }} />
                            <span style={{ color: '#88ff00' }}>🌧️ Acid Rain</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={sandstormEnabled.current} onChange={() => { sandstormEnabled.current = !sandstormEnabled.current }} style={{ width: 16, height: 16, accentColor: '#c4a84f' }} />
                            <span style={{ color: '#c4a84f' }}>🏜️ Sandstorm</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={godMode.current} onChange={() => { godMode.current = !godMode.current }} style={{ width: 16, height: 16, accentColor: '#ffd700' }} />
                            <span style={{ color: '#ffd700', fontWeight: 'bold' }}>⚡ God Mode</span>
                        </label>
                    </div>

                    <div style={{ borderTop: '1px solid #ff00ff33', margin: '10px 0' }} />

                    {/* === GRAPHICS === */}
                    <div style={{ color: '#00ffff88', fontSize: 10, fontWeight: 'bold', marginBottom: 6, letterSpacing: 1 }}>⚙️ GRAPHICS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={showFog.current} onChange={() => { showFog.current = !showFog.current; bgFrameCounter.current = 0 }} style={{ width: 16, height: 16, accentColor: '#88aacc' }} />
                            <span style={{ color: '#88aacc' }}>🌫️ Fog</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={showSkyline.current} onChange={() => { showSkyline.current = !showSkyline.current }} style={{ width: 16, height: 16, accentColor: '#aa88ff' }} />
                            <span style={{ color: '#aa88ff' }}>🏙️ Skyline</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={showBeacons.current} onChange={() => { showBeacons.current = !showBeacons.current }} style={{ width: 16, height: 16, accentColor: '#ff4444' }} />
                            <span style={{ color: '#ff4444' }}>🔴 Beacons</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={showFlyingCars.current} onChange={() => { showFlyingCars.current = !showFlyingCars.current }} style={{ width: 16, height: 16, accentColor: '#ffffcc' }} />
                            <span style={{ color: '#ffffcc' }}>🚗 Flying Cars</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={showGlow.current} onChange={() => { showGlow.current = !showGlow.current }} style={{ width: 16, height: 16, accentColor: '#ff88ff' }} />
                            <span style={{ color: '#ff88ff' }}>✨ Glow Effects</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={showParticles.current} onChange={() => { showParticles.current = !showParticles.current }} style={{ width: 16, height: 16, accentColor: '#ffaa44' }} />
                            <span style={{ color: '#ffaa44' }}>💥 Particles</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={showWeatherFX.current} onChange={() => { showWeatherFX.current = !showWeatherFX.current }} style={{ width: 16, height: 16, accentColor: '#66ff66' }} />
                            <span style={{ color: '#66ff66' }}>🌧️ Weather FX</span>
                        </label>
                    </div>

                    <div style={{ borderTop: '1px solid #ff00ff33', margin: '10px 0' }} />

                    {/* === VIEW === */}
                    <div style={{ color: '#00ffff88', fontSize: 10, fontWeight: 'bold', marginBottom: 6, letterSpacing: 1 }}>📱 VIEW</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                if (!document.fullscreenElement) {
                                    containerRef.current?.requestFullscreen()
                                } else {
                                    document.exitFullscreen()
                                }
                            }}
                            style={{
                                background: isFullscreen ? '#ff00ff33' : '#00ffff22',
                                border: `1px solid ${isFullscreen ? '#ff00ff' : '#00ffff'}`,
                                color: isFullscreen ? '#ff00ff' : '#00ffff',
                                borderRadius: 6,
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 'bold',
                                fontFamily: 'sans-serif'
                            }}
                        >
                            {isFullscreen ? '⬜ Exit Fullscreen' : '⬛ Fullscreen'}
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 2 }}>
                            <input
                                type="checkbox"
                                checked={simulateMobile}
                                onChange={(e) => {
                                    e.stopPropagation()
                                    setSimulateMobile(!simulateMobile)
                                }}
                                style={{ width: 16, height: 16, accentColor: '#ff8800' }}
                            />
                            <span style={{ color: '#ff8800' }}>📱 Mobile View</span>
                        </label>
                    </div>

                    <div style={{ marginTop: 10, color: '#666', fontSize: 10 }}>
                        Press ` to toggle
                    </div>
                </div>
            )}

            <audio
                ref={audioRef}
                src="/background.mp3"
                preload="auto"
                onEnded={() => {
                    if (audioRef.current) {
                        if (songLevel.current === 1) {
                            // Switch to Level 2 (Play once)
                            songLevel.current = 2
                            audioRef.current.src = '/level2.mp3'
                            audioRef.current.loop = false
                            audioRef.current.play().catch(() => { })
                        } else if (songLevel.current === 2) {
                            // Switch to Level 3 (Loop forever)
                            songLevel.current = 3
                            audioRef.current.src = '/level3.mp3'
                            audioRef.current.loop = true
                            audioRef.current.play().catch(() => { })
                        }
                    }
                }}
            />
            <audio
                ref={menuAudioRef}
                src="/menu.mp3"
                preload="auto"
                loop
            />
            <audio
                ref={citySoundsRef}
                src="/citysounds.mp3"
                preload="auto"
                loop
            />
        </div>
    )
}

export default GameEngine

