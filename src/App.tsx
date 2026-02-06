import GameEngine from './GameEngine'

function App() {
  return (
    <div className="crt-container">
      <GameEngine />
      <div className="crt-overlay" />
      <div className="scanlines" />
      <div className="chromatic-left" />
      <div className="chromatic-right" />
    </div>
  )
}

export default App
