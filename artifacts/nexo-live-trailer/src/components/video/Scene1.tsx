import { motion } from 'framer-motion';

export function Scene1() {
  return (
    <motion.section
      className="reveal-scene"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.55, ease: 'linear' }}
    >
      <motion.img
        className="macro-symbol"
        src={`${import.meta.env.BASE_URL}images/nexo-live-mark.svg`}
        alt="Nexo Live voice mark"
        initial={{ x: '-50%', y: '32vh', scale: 3.45 }}
        animate={{ x: '-50%', y: 0, scale: 3.3 }}
        transition={{
          x: { duration: 0 },
          y: { type: 'spring', stiffness: 120, damping: 20, mass: 1 },
          scale: { type: 'spring', stiffness: 170, damping: 24, mass: 1 },
        }}
      />
    </motion.section>
  );
}
