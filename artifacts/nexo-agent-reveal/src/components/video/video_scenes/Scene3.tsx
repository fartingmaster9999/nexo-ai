import { motion } from 'framer-motion';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene3({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt="NexoAI — Agent Mode"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 1, scale: 4, y: '15%' }}
        animate={{
          opacity: 1,
          scale: [4, 1, 1.015, 1],
          y: ['15%', '0%', '0%', '0%'],
        }}
        transition={{ duration: 4.2, times: [0, 0.15, 0.8, 1], ease: EASE }}
        style={{ transformOrigin: '50% 35%' }}
        draggable={false}
      />
    </motion.section>
  );
}
