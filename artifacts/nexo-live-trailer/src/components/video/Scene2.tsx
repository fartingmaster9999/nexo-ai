import { motion } from 'framer-motion';

export function Scene2() {
  return (
    <motion.section
      className="reveal-scene live-card"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.55, ease: 'linear' }}
    >
      <div className="live-lockup">
        <img
          className="live-symbol"
          src={`${import.meta.env.BASE_URL}images/nexo-live-mark.svg`}
          alt="Nexo Live voice mark"
        />
        <h1 className="live-wordmark">NEXO LIVE</h1>
        <p className="live-feature">
          Real-time voice conversation using Gemini Live API
        </p>
      </div>
    </motion.section>
  );
}
