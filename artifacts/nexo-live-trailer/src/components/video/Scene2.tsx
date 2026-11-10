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
        <motion.img
          className="live-symbol"
          src={`${import.meta.env.BASE_URL}images/nexo-live-mark.svg`}
          alt="Nexo Live voice mark"
          initial={{ x: '-50%', scale: 0.92, opacity: 0 }}
          animate={{ x: '-50%', scale: 1, opacity: 1 }}
          transition={{
            x: { duration: 0 },
            scale: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
            opacity: { duration: 0.42, ease: 'linear' },
          }}
        />
        <motion.h1
          className="live-wordmark"
          initial={{ x: '-50%', y: '0.7vmin', opacity: 0 }}
          animate={{ x: '-50%', y: 0, opacity: 1 }}
          transition={{
            x: { duration: 0 },
            y: { duration: 0.42, delay: 0.12, ease: [0.16, 1, 0.3, 1] },
            opacity: { duration: 0.34, delay: 0.12, ease: 'linear' },
          }}
        >
          NEXO LIVE
        </motion.h1>
        <motion.p
          className="live-feature"
          initial={{ x: '-50%', y: '0.45vmin', opacity: 0 }}
          animate={{ x: '-50%', y: 0, opacity: 1 }}
          transition={{
            x: { duration: 0 },
            y: { duration: 0.42, delay: 0.24, ease: [0.16, 1, 0.3, 1] },
            opacity: { duration: 0.34, delay: 0.24, ease: 'linear' },
          }}
        >
          Real-time voice conversation using Gemini Live API
        </motion.p>
      </div>
    </motion.section>
  );
}
