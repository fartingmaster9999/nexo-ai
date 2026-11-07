import { motion } from 'framer-motion';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene1({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.55, ease: 'linear' }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 3.3, y: '32%', opacity: 1 }}
        animate={{
          scale: 3.3,
          y: ['32%', '0%', '0%'],
          opacity: 1,
        }}
        transition={{
          duration: 1.8,
          times: [0, 0.86, 1],
          ease: EASE,
        }}
        style={{ transformOrigin: '50% 35%' }}
        draggable={false}
      />
    </motion.section>
  );
}
