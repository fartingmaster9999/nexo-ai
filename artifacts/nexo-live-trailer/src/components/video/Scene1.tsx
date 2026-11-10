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
        initial={{ x: '-50%', y: '32vh', scale: 3.3 }}
        animate={{ x: '-50%', y: 0, scale: 3.3 }}
        transition={{
          x: { duration: 0 },
          y: { duration: 1.55, ease: [0.22, 1, 0.36, 1] },
          scale: { duration: 0 },
        }}
      />
    </motion.section>
  );
}
