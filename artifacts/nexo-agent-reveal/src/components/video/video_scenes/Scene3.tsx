import { motion } from 'framer-motion';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene3({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 1, scale: 1.035 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt="NexoAI — Agent Mode"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 1, scale: 1.08 }}
        animate={{ opacity: 1, scale: [1.08, 1, 1.015, 1] }}
        transition={{ duration: 4.2, times: [0, 0.12, 0.8, 1], ease: EASE }}
        draggable={false}
      />
      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-[48%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '-104%' }}
        transition={{ duration: 0.4, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-[48%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '104%' }}
        transition={{ duration: 0.4, ease: EASE }}
      />
    </motion.section>
  );
}
