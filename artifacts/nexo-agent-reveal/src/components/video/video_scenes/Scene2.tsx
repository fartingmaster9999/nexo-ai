import { motion } from 'framer-motion';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene2({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.08 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.15 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      <motion.video
        src={`${import.meta.env.BASE_URL}video/nexo-agent-mode.mp4`}
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 1.12, opacity: 0.52 }}
        animate={{ scale: [1.12, 1, 1.06, 1.34], opacity: [0.52, 1, 1, 0.96] }}
        transition={{ duration: 3.95, times: [0, 0.14, 0.7, 1], ease: EASE }}
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
        transition={{ delay: 0.03, duration: 0.58, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '102%' }}
        transition={{ delay: 0.03, duration: 0.58, ease: EASE }}
      />
      <motion.div
        className="absolute left-1/2 top-[12%] z-30 h-[76%] w-[0.24vmin] -translate-x-1/2"
        initial={{ scaleY: 0.1, opacity: 0.3 }}
        animate={{ scaleY: [0.1, 1, 0.5, 1.4], opacity: [0.3, 1, 0.2, 0] }}
        transition={{ duration: 3.4, times: [0, 0.14, 0.68, 1], ease: EASE }}
        style={{ background: '#8dc5ff', boxShadow: '0 0 2vmin rgba(31,119,255,.95)' }}
      />
      <motion.div
        className="absolute inset-y-0 z-10 w-[0.18vmin]"
        initial={{ left: '16%', opacity: 0 }}
        animate={{ left: ['16%', '53%', '82%'], opacity: [0, 0.68, 0] }}
        transition={{ delay: 1.08, duration: 0.82, ease: EASE }}
        style={{ background: 'rgba(160,207,255,.8)', boxShadow: '0 0 1.7vmin rgba(49,132,255,.9)' }}
      />
    </motion.section>
  );
}
