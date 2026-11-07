import { motion } from 'framer-motion';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene1({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 1, scale: 1.015 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.12 }}
      transition={{ duration: 0.18, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 3.3, y: '15%', opacity: 1 }}
        animate={{
          scale: [3.3, 3.3, 3.08, 3.34, 3.05, 3.45, 3.45, 4.25],
          opacity: [1, 1, 0.045, 1, 0.04, 1, 1, 0.18],
        }}
        transition={{
          duration: 1.8,
          times: [0, 0.1, 0.2, 0.3, 0.38, 0.44, 0.62, 1],
          ease: 'linear',
        }}
        style={{ transformOrigin: '50% 35%' }}
        draggable={false}
      />

      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-[38%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '-104%' }}
        transition={{ duration: 0.18, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-[38%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '104%' }}
        transition={{ duration: 0.18, ease: EASE }}
      />
    </motion.section>
  );
}
