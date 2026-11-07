import { motion } from 'framer-motion';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene2({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.08 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.13 }}
      transition={{ duration: 0.48, ease: EASE }}
    >
      <motion.video
        src={`${import.meta.env.BASE_URL}video/nexo-agent-mode.mp4`}
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 1.16, opacity: 0.58 }}
        animate={{ scale: [1.16, 1, 1.055, 1.32], opacity: [0.58, 1, 1, 0.95] }}
        transition={{ duration: 5.9, times: [0, 0.2, 0.72, 1], ease: EASE }}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />

      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '-102%' }}
        transition={{ delay: 0.08, duration: 0.88, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '102%' }}
        transition={{ delay: 0.08, duration: 0.88, ease: EASE }}
      />
      <motion.div
        className="absolute left-1/2 top-[13%] z-30 h-[74%] w-[0.24vmin] -translate-x-1/2"
        initial={{ scaleY: 0.12, opacity: 0.2 }}
        animate={{ scaleY: [0.12, 1, 0.65, 1.45], opacity: [0.2, 0.95, 0.32, 0] }}
        transition={{ duration: 5.45, times: [0, 0.16, 0.68, 1], ease: EASE }}
        style={{ background: '#7abaff', boxShadow: '0 0 2vmin rgba(31,119,255,.95)' }}
      />
      <motion.div
        className="absolute inset-y-0 z-10 w-[0.18vmin]"
        initial={{ left: '18%', opacity: 0 }}
        animate={{ left: ['18%', '50%', '79%'], opacity: [0, 0.55, 0] }}
        transition={{ delay: 1.7, duration: 1.25, ease: EASE }}
        style={{ background: 'rgba(141,194,255,.72)', boxShadow: '0 0 1.6vmin rgba(49,132,255,.8)' }}
      />
    </motion.section>
  );
}
