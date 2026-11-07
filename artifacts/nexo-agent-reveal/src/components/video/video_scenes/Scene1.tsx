import { motion } from 'framer-motion';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene1({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.045 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.12 }}
      transition={{ duration: 0.26, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 3.2, y: '15%', opacity: 0.3 }}
        animate={{ scale: [3.2, 3.45, 3.7, 4.2], opacity: [0.3, 1, 1, 1] }}
        transition={{ duration: 3.95, times: [0, 0.15, 0.58, 1], ease: EASE }}
        style={{ transformOrigin: '50% 35%' }}
        draggable={false}
      />

      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-[38%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '-104%' }}
        transition={{ duration: 0.48, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-[38%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '104%' }}
        transition={{ duration: 0.48, ease: EASE }}
      />
    </motion.section>
  );
}
