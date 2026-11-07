import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Repeat,
} from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';

const SCENE_DETAILS: Record<string, { title: string; filePath: string }> = {
  signal: { title: 'Signal', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
  agent: { title: 'Agent footage', filePath: 'src/components/video/video_scenes/Scene2.tsx' },
  logo: { title: 'Logo flashes', filePath: 'src/components/video/video_scenes/Scene3.tsx' },
  reveal: { title: 'Full reveal', filePath: 'src/components/video/video_scenes/Scene4.tsx' },
};

const PROGRESS_TICK_MS = 60;

function formatPlaybackTime(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const {
    sceneKeys,
    activeIndex,
    locked,
    paused,
    mountKey,
    tick,
    durations,
    activeDuration,
    activeStartTime,
    totalDuration,
    onSceneChange,
    jumpTo,
    toggleLock,
    togglePause,
  } = useSceneControls(SCENE_DURATIONS);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensorRef = useRef<HTMLDivElement | null>(null);

  const handleJumpTo = useCallback(
    (index: number) => {
      jumpTo(index);
      const details = SCENE_DETAILS[sceneKeys[index]];
      if (!details?.filePath) return;
      window.parent.postMessage(
        {
          type: 'REPLIT_VIDEO_SCENE_SELECTED',
          payload: {
            sceneIndex: index,
            sceneCount: sceneKeys.length,
            sceneTitle: details.title,
            filePath: details.filePath,
            lineNumber: 1,
          },
        },
        '*',
      );
    },
    [jumpTo, sceneKeys],
  );

  const handlePointerEnter = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') setHovering(true);
  }, []);
  const handlePointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') setHovering(false);
  }, []);
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' && collapsed) setTapPinned(true);
    },
    [collapsed],
  );
  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      if (!value) {
        setHovering(false);
        setTapPinned(false);
      }
      return !value;
    });
  }, []);

  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      if (sensorRef.current && !sensorRef.current.contains(event.target as Node)) {
        setTapPinned(false);
      }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown);
  }, [collapsed, tapPinned]);

  useEffect(() => {
    if (!paused) return;
    const frozen = document
      .getAnimations()
      .filter((animation) => animation.playState === 'running');
    frozen.forEach((animation) => animation.pause());
    return () => frozen.forEach((animation) => animation.play());
  }, [paused]);

  if (!isIframed) return <VideoTemplate />;

  return (
    <div className="relative h-screen w-full">
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop
        paused={paused}
        onSceneChange={onSceneChange}
      />
      <div
        ref={sensorRef}
        className="absolute bottom-0 left-0 right-0 z-50 flex flex-col justify-end"
        style={{ height: '25%' }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        <div className="w-full flex-1" aria-hidden="true" />
        <div
          className={`flex items-center gap-2 border-t border-white/10 bg-[#07101f]/90 px-3 py-2.5 text-white backdrop-blur-md transition-all duration-200 sm:gap-3 sm:px-5 sm:py-3 ${
            !collapsed || hovering || tapPinned
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-full opacity-0'
          }`}
          aria-hidden={collapsed && !hovering && !tapPinned}
        >
          <button
            onClick={togglePause}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:h-12 sm:w-12"
            title={paused ? 'Play' : 'Pause'}
            aria-label={paused ? 'Play' : 'Pause'}
          >
            {paused ? <Play size={22} /> : <Pause size={22} />}
          </button>
          <button
            onClick={toggleLock}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/10 sm:h-12 sm:w-12 ${
              locked ? 'bg-white/15 text-white' : 'text-white/65 hover:text-white'
            }`}
            title={locked ? 'Loop current scene: on' : 'Loop current scene: off'}
            aria-label={locked ? 'Loop current scene: on' : 'Loop current scene: off'}
            aria-pressed={locked}
          >
            <Repeat size={21} />
          </button>
          <div className="hidden h-8 w-px shrink-0 bg-white/15 sm:block" aria-hidden="true" />
          <PlaybackStatus
            sceneKeys={sceneKeys}
            activeIndex={activeIndex}
            activeDuration={activeDuration}
            activeStartTime={activeStartTime}
            totalDuration={totalDuration}
            tick={tick}
            paused={paused}
            onJumpTo={handleJumpTo}
          />
          <button
            onClick={toggleCollapsed}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white sm:h-12 sm:w-12"
            title={collapsed ? 'Show controls' : 'Hide controls'}
            aria-label={collapsed ? 'Show controls' : 'Hide controls'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaybackStatus({
  sceneKeys,
  activeIndex,
  activeDuration,
  activeStartTime,
  totalDuration,
  tick,
  paused,
  onJumpTo,
}: {
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  activeStartTime: number;
  totalDuration: number;
  tick: number;
  paused: boolean;
  onJumpTo: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const elapsedBaseRef = useRef(0);

  useEffect(() => {
    setElapsed(0);
    elapsedBaseRef.current = 0;
  }, [tick]);

  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const id = window.setInterval(() => {
      setElapsed(elapsedBaseRef.current + (performance.now() - start));
    }, PROGRESS_TICK_MS);
    return () => {
      window.clearInterval(id);
      elapsedBaseRef.current += performance.now() - start;
    };
  }, [tick, paused]);

  const progress = activeDuration > 0 ? Math.min(1, elapsed / activeDuration) : 0;
  const totalElapsed = Math.min(
    totalDuration,
    activeStartTime + Math.min(elapsed, activeDuration),
  );

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {sceneKeys.map((key, index) => (
          <button
            key={key}
            onClick={() => onJumpTo(index)}
            className="relative h-2 min-h-3 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/20 transition-colors hover:bg-white/30"
            aria-label={`Jump to scene ${index + 1}`}
            aria-current={index === activeIndex ? 'true' : undefined}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-[#73b3ff]"
              style={{
                width: `${index < activeIndex ? 100 : index === activeIndex ? progress * 100 : 0}%`,
                transition: 'width 100ms linear',
              }}
            />
          </button>
        ))}
      </div>
      <div className="hidden shrink-0 font-mono text-sm tabular-nums text-white/65 md:block">
        {activeIndex + 1}/{sceneKeys.length}
      </div>
      <div
        className="hidden min-w-[9ch] shrink-0 text-right font-mono text-xs tabular-nums text-white/75 sm:block"
        role="timer"
        aria-label={`Playback time ${formatPlaybackTime(totalElapsed)} of ${formatPlaybackTime(totalDuration)}`}
      >
        {formatPlaybackTime(totalElapsed)} / {formatPlaybackTime(totalDuration)}
      </div>
    </>
  );
}
