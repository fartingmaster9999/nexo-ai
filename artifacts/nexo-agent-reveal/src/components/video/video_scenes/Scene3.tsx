import { motion } from 'framer-motion';

export function Scene3({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.55, ease: 'linear' }}
    >
      <img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt="NexoAI — Agent Mode"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
    </motion.section>
  );
}
