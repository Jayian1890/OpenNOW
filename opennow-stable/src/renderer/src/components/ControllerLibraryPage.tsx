import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { GameInfo, Settings } from "@shared/gfn";
import { Star, Clock, Calendar, Repeat2 } from "lucide-react";
import { ButtonA, ButtonX, ButtonY } from "./ControllerButtons";
import { getStoreDisplayName } from "./GameCard";
import { type PlaytimeStore, formatPlaytime, formatLastPlayed } from "../utils/usePlaytime";

interface ControllerLibraryPageProps {
  games: GameInfo[];
  isLoading: boolean;
  selectedGameId: string;
  uiSoundsEnabled: boolean;
  selectedVariantByGameId: Record<string, string>;
  favoriteGameIds: string[];
  userName?: string;
  userAvatarUrl?: string;
  playtimeData?: PlaytimeStore;
  onSelectGame: (id: string) => void;
  onSelectGameVariant: (gameId: string, variantId: string) => void;
  onToggleFavoriteGame: (gameId: string) => void;
  onPlayGame: (game: GameInfo) => void;
  onOpenSettings?: () => void;
  currentStreamingGame?: GameInfo | null;
  onResumeGame?: (game: GameInfo) => void;
  onCloseGame?: () => void;
  pendingSwitchGameCover?: string | null;
  settings?: {
    resolution?: string;
    fps?: number;
    codec?: string;
    controllerUiSounds?: boolean;
    autoLoadControllerLibrary?: boolean;
    aspectRatio?: string;
  };
  resolutionOptions?: string[];
  fpsOptions?: number[];
  codecOptions?: string[];
  aspectRatioOptions?: string[];
  onSettingChange?: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

type Direction = "up" | "down" | "left" | "right";
type TopCategory = "current" | "all" | "settings" | "favorites" | `genre:${string}`;
type SoundKind = "move" | "confirm";

const CATEGORY_STEP_PX = 160;
const CATEGORY_ACTIVE_HALF_WIDTH_PX = 60;
const GAME_ACTIVE_CENTER_OFFSET_X_PX = 320;

function sanitizeGenreName(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getCategoryLabel(categoryId: string, currentGameTitle?: string): { label: string } {
  if (categoryId === "current") return { label: currentGameTitle || "Current" };
  if (categoryId === "all") return { label: "All" };
  if (categoryId === "settings") return { label: "Settings" };
  if (categoryId === "favorites") return { label: "Favorites" };
  const genreName = sanitizeGenreName(categoryId.slice(6));
  const shorthand: Record<string, string> = {
    "massively multiplayer online battle arena": "MOBA",
    "massively multiplayer online": "MMO",
    "multiplayer online battle arena": "MOBA",
    "first person shooter": "FPS",
    "role playing game": "RPG",
    "real time strategy": "RTS",
    "simulation": "Sim",
    "virtual reality": "VR",
    "third person shooter": "TPS",
  };
  const normalized = genreName.toLowerCase();
  const display = shorthand[normalized] ?? genreName;
  return { label: display };
}


export function ControllerLibraryPage({
  games,
  isLoading,
  selectedGameId,
  uiSoundsEnabled,
  selectedVariantByGameId,
  favoriteGameIds,
  onSelectGame,
  onSelectGameVariant,
  onToggleFavoriteGame,
  onPlayGame,
  onOpenSettings,
  currentStreamingGame,
  onResumeGame,
  onCloseGame,
  pendingSwitchGameCover,
  userName = "Player One",
  userAvatarUrl,
  playtimeData = {},
  settings = {},
  resolutionOptions = [],
  fpsOptions = [],
  codecOptions = [],
  aspectRatioOptions = [],
  onSettingChange,
}: ControllerLibraryPageProps): JSX.Element {
  const initialCategoryIndex = currentStreamingGame ? 0 : 1;
  const [categoryIndex, setCategoryIndex] = useState(initialCategoryIndex);
  const audioContextRef = useRef<AudioContext | null>(null);
  const itemsContainerRef = useRef<HTMLDivElement>(null);
  const [listTranslateY, setListTranslateY] = useState(0);
  const favoriteGameIdSet = useMemo(() => new Set(favoriteGameIds), [favoriteGameIds]);
  const [time, setTime] = useState(new Date());
  const [selectedSettingIndex, setSelectedSettingIndex] = useState(0);
  const [microphoneDevices, setMicrophoneDevices] = useState<{ deviceId: string; label: string }[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const playUiSound = useCallback((kind: SoundKind): void => {
    if (!uiSoundsEnabled) return;
    const audioContext = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = audioContext;
    if (audioContext.state === "suspended") void audioContext.resume();

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    const profile: Record<SoundKind, { start: number; end: number; duration: number; volume: number; type: OscillatorType }> = {
      move: { start: 720, end: 680, duration: 0.04, volume: 0.02, type: "triangle" },
      confirm: { start: 640, end: 860, duration: 0.1, volume: 0.04, type: "sine" },
    };

    const active = profile[kind];
    oscillator.type = active.type;
    oscillator.frequency.setValueAtTime(active.start, now);
    oscillator.frequency.exponentialRampToValueAtTime(active.end, now + active.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(active.volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + active.duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + active.duration + 0.01);
  }, [uiSoundsEnabled]);

  const allGenres = useMemo(() => {
    const genreSet = new Set<string>();
    for (const game of games) {
      if (game.genres && Array.isArray(game.genres)) {
        for (const genre of game.genres) genreSet.add(genre);
      }
    }
    return Array.from(genreSet).sort();
  }, [games]);

  const TOP_CATEGORIES = useMemo(() => {
    const categories: Array<{ id: TopCategory; label: string }> = [];
    if (currentStreamingGame) {
      categories.push({ id: "current", label: currentStreamingGame.title || "Current Game" });
    }
    categories.push({ id: "settings", label: "Settings" });
    categories.push({ id: "all", label: "All" });
    categories.push({ id: "favorites", label: "Favorites" });
    for (const genre of allGenres) categories.push({ id: `genre:${genre}`, label: sanitizeGenreName(genre) });
    return categories;
  }, [allGenres, currentStreamingGame]);

  const topCategory = TOP_CATEGORIES[categoryIndex]?.id ?? "all";

  const settingsItems = useMemo(() => [
    { id: "aspectRatio", label: "Aspect Ratio", value: settings.aspectRatio || "16:9" },
    { id: "resolution", label: "Resolution", value: settings.resolution || "1920x1080" },
    { id: "fps", label: "Frame Rate", value: `${settings.fps || 60} FPS` },
    { id: "codec", label: "Video Codec", value: settings.codec || "H264" },
    { id: "microphone", label: "Microphone", value: (() => {
      const id = (settings as any).microphoneDeviceId as string | undefined;
      if (!id) return "Default";
      const found = microphoneDevices.find(d => d.deviceId === id);
      return found?.label ?? id;
    })() },
    { id: "sounds", label: "UI Sounds", value: settings.controllerUiSounds ? "On" : "Off" },
    { id: "autoLoad", label: "Auto-Load Library", value: (settings as any).autoLoadControllerLibrary ? "On" : "Off" },
    { id: "exit", label: "Exit Controller Mode", value: "" },
  ], [settings, microphoneDevices]);

  const currentGameItems = useMemo(() => [
    { id: "resume", label: "Resume Game", value: "" },
    { id: "closeGame", label: "Close Game", value: "" },
  ], []);

  const displayItems = useMemo(() => {
    if (topCategory === "current") return currentGameItems;
    if (topCategory === "settings") return settingsItems;
    return [];
  }, [topCategory, currentGameItems, settingsItems]);

  useEffect(() => {
    let mounted = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(devs => {
      if (!mounted) return;
      const mics = devs
        .filter(d => d.kind === "audioinput")
        .map(d => ({ deviceId: d.deviceId, label: d.label || "Microphone" }));
      // Ensure there's at least a default entry
      if (mics.length === 0) mics.push({ deviceId: "", label: "Default" });
      setMicrophoneDevices(mics);
    }).catch(() => {
      if (!mounted) return;
      setMicrophoneDevices([{ deviceId: "", label: "Default" }]);
    });
    return () => { mounted = false; };
  }, []);

  const categorizedGames = useMemo(() => {
    if (topCategory === "settings") return [];
    if (topCategory === "favorites") return games.filter((game) => favoriteGameIdSet.has(game.id));
    if (topCategory.startsWith("genre:")) {
      const genreName = topCategory.slice(6);
      return games.filter((game) => game.genres?.includes(genreName));
    }
    return games;
  }, [games, favoriteGameIdSet, topCategory]);

  const selectedIndex = useMemo(() => {
    const index = categorizedGames.findIndex((game) => game.id === selectedGameId);
    return index >= 0 ? index : 0;
  }, [categorizedGames, selectedGameId]);

  const selectedGame = useMemo(() => categorizedGames[selectedIndex] ?? null, [categorizedGames, selectedIndex]);

  const selectedVariantId = useMemo(() => {
    if (!selectedGame) return "";
    const current = selectedVariantByGameId[selectedGame.id];
    return current ?? selectedGame.variants[0]?.id ?? "";
  }, [selectedGame, selectedVariantByGameId]);



  useEffect(() => {
    const container = itemsContainerRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0 || selectedIndex >= children.length) return;
    let offset = 0;
    for (let i = 0; i < selectedIndex; i++) {
      const childStyle = window.getComputedStyle(children[i]);
      offset += children[i].offsetHeight + parseFloat(childStyle.marginBottom);
    }
    offset += children[selectedIndex].offsetHeight / 2;
    setListTranslateY(-offset);
  }, [selectedIndex, categorizedGames]);

  const throttledOnSelectGame = useCallback((id: string) => onSelectGame(id), [onSelectGame]);

  const toggleFavoriteForSelected = useCallback(() => {
    if (selectedGame) {
      onToggleFavoriteGame(selectedGame.id);
      playUiSound("confirm");
    }
  }, [onToggleFavoriteGame, playUiSound, selectedGame]);

  useEffect(() => {
    const applyDirection = (direction: Direction): void => {
      if (isLoading && topCategory !== "settings" && topCategory !== "current") return;
      if (direction === "left") {
        playUiSound("move");
        setCategoryIndex((prev) => (prev - 1 + TOP_CATEGORIES.length) % TOP_CATEGORIES.length);
        setSelectedSettingIndex(0);
        return;
      }
      if (direction === "right") {
        playUiSound("move");
        setCategoryIndex((prev) => (prev + 1) % TOP_CATEGORIES.length);
        setSelectedSettingIndex(0);
        return;
      }
      if (topCategory === "current" || topCategory === "settings") {
        if (direction === "up") {
          const nextIndex = Math.max(0, selectedSettingIndex - 1);
          if (nextIndex !== selectedSettingIndex) {
            playUiSound("move");
            setSelectedSettingIndex(nextIndex);
          }
          return;
        }
        if (direction === "down") {
          const nextIndex = Math.min(displayItems.length - 1, selectedSettingIndex + 1);
          if (nextIndex !== selectedSettingIndex) {
            playUiSound("move");
            setSelectedSettingIndex(nextIndex);
          }
          return;
        }
        return;
      }
      if (categorizedGames.length === 0) return;
      if (direction === "up") {
        const nextIndex = Math.max(0, selectedIndex - 1);
        if (nextIndex !== selectedIndex) {
          playUiSound("move");
          throttledOnSelectGame(categorizedGames[nextIndex].id);
        }
        return;
      }
      if (direction === "down") {
        const nextIndex = Math.min(categorizedGames.length - 1, selectedIndex + 1);
        if (nextIndex !== selectedIndex) {
          playUiSound("move");
          throttledOnSelectGame(categorizedGames[nextIndex].id);
        }
        return;
      }
    };

    const handler = (e: any) => {
      if (e.detail?.direction) applyDirection(e.detail.direction);
    };

    const activateHandler = () => {
      if (topCategory === "current") {
        const item = displayItems[selectedSettingIndex];
        if (item?.id === "resume" && currentStreamingGame && onResumeGame) {
          onResumeGame(currentStreamingGame);
          playUiSound("confirm");
          return;
        }
        if (item?.id === "closeGame" && onCloseGame) {
          onCloseGame();
          playUiSound("confirm");
          return;
        }
        return;
      }
      if (topCategory === "settings") {
        const setting = displayItems[selectedSettingIndex];
        if (setting?.id === "exit" && onSettingChange) {
          onSettingChange("controllerMode" as any, false as any);
          playUiSound("confirm");
          const nextSettingsIndex = currentStreamingGame ? 1 : 0;
          setCategoryIndex(nextSettingsIndex); // go back to All or Current
          setSelectedSettingIndex(0);
          return;
        }
        playUiSound("confirm");
      } else if (selectedGame) {
        onPlayGame(selectedGame);
        playUiSound("confirm");
      }
    };

    const secondaryActivateHandler = () => {
        if (topCategory === "current") {
          // X button does nothing on current game menu items
          return;
        }
        if (topCategory === "settings") {
          // X button cycles through setting values (no-op for Exit)
          const setting = displayItems[selectedSettingIndex];
          if (!setting || !onSettingChange) return;
          if (setting.id === "exit") return;

          // Microphone device cycling
          if (setting.id === "microphone") {
            const current = (settings as any).microphoneDeviceId as string | undefined;
            const list = microphoneDevices.length > 0 ? microphoneDevices : [{ deviceId: "", label: "Default" }];
            const ids = list.map(d => d.deviceId);
            const curIdx = ids.indexOf(current ?? "");
            const nextIdx = (curIdx + 1) % ids.length;
            onSettingChange("microphoneDeviceId" as any, ids[nextIdx] as any);
            playUiSound("move");
            return;
          }
          
          if (setting.id === "aspectRatio" && aspectRatioOptions.length > 0) {
            const currentIdx = aspectRatioOptions.indexOf(settings.aspectRatio || "16:9");
            const nextIdx = (currentIdx + 1) % aspectRatioOptions.length;
            onSettingChange("aspectRatio", aspectRatioOptions[nextIdx] as any);
            playUiSound("move");
          } else if (setting.id === "resolution" && resolutionOptions.length > 0) {
            const currentIdx = resolutionOptions.indexOf(settings.resolution || "1920x1080");
            const nextIdx = (currentIdx + 1) % resolutionOptions.length;
            onSettingChange("resolution", resolutionOptions[nextIdx]);
            playUiSound("move");
          } else if (setting.id === "fps" && fpsOptions.length > 0) {
            const currentIdx = fpsOptions.indexOf(settings.fps || 60);
            const nextIdx = (currentIdx + 1) % fpsOptions.length;
            onSettingChange("fps", fpsOptions[nextIdx]);
            playUiSound("move");
          } else if (setting.id === "codec" && codecOptions.length > 0) {
            const currentIdx = codecOptions.indexOf(settings.codec || "H264");
            const nextIdx = (currentIdx + 1) % codecOptions.length;
            onSettingChange("codec", codecOptions[nextIdx] as any);
            playUiSound("move");
          } else if (setting.id === "sounds") {
            onSettingChange("controllerUiSounds", !(settings.controllerUiSounds || false));
            playUiSound("move");
          } else if (setting.id === "autoLoad") {
            onSettingChange("autoLoadControllerLibrary", !((settings as any).autoLoadControllerLibrary || false));
            playUiSound("move");
          }
          return;
        }
      if (selectedGame && selectedGame.variants.length > 1) {
        const idx = selectedGame.variants.findIndex(v => v.id === selectedVariantId);
        const next = selectedGame.variants[(idx + 1) % selectedGame.variants.length];
        onSelectGameVariant(selectedGame.id, next.id);
        playUiSound("move");
      }
    };

    const tertiaryActivateHandler = () => {
      if (topCategory !== "settings" && topCategory !== "current") {
        toggleFavoriteForSelected();
      }
    };

    const kbdHandler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "ArrowLeft") applyDirection("left");
      else if (e.key === "ArrowRight") applyDirection("right");
      else if (e.key === "ArrowUp") applyDirection("up");
      else if (e.key === "ArrowDown") applyDirection("down");
      else if (e.key === "Enter") activateHandler();
      else if (e.key.toLowerCase() === "x") secondaryActivateHandler();
      else if (e.key.toLowerCase() === "y") tertiaryActivateHandler();
      else if (e.key === "Escape") {
        if (topCategory === "current" || topCategory === "settings") {
          setCategoryIndex((prev) => (prev - 1 + TOP_CATEGORIES.length) % TOP_CATEGORIES.length);
        } else {
          onOpenSettings?.();
        }
      }
    };

    window.addEventListener("opennow:controller-direction", handler);
    window.addEventListener("opennow:controller-activate", activateHandler);
    window.addEventListener("opennow:controller-secondary-activate", secondaryActivateHandler);
    window.addEventListener("opennow:controller-tertiary-activate", tertiaryActivateHandler);
    window.addEventListener("keydown", kbdHandler);
    return () => {
      window.removeEventListener("opennow:controller-direction", handler);
      window.removeEventListener("opennow:controller-activate", activateHandler);
      window.removeEventListener("opennow:controller-secondary-activate", secondaryActivateHandler);
      window.removeEventListener("opennow:controller-tertiary-activate", tertiaryActivateHandler);
      window.removeEventListener("keydown", kbdHandler);
    };
  }, [isLoading, TOP_CATEGORIES.length, categorizedGames, selectedIndex, selectedGame, selectedVariantId, onPlayGame, onSelectGameVariant, onOpenSettings, playUiSound, throttledOnSelectGame, toggleFavoriteForSelected, topCategory, selectedSettingIndex, displayItems, settingsItems, settings, onSettingChange, resolutionOptions, fpsOptions, codecOptions, aspectRatioOptions, currentStreamingGame, onResumeGame, onCloseGame]);

  if (isLoading && topCategory !== "settings" && topCategory !== "current") return <div className="xmb-wrapper"><div className="xmb-bg-layer"><div className="xmb-bg-gradient" /></div><div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh'}}>Loading...</div></div>;

  return (
    <div className="xmb-wrapper">
      <div className="xmb-bg-layer">
        <div className="xmb-bg-gradient" />
        <div className="xmb-bg-overlay" />
      </div>

      <div className="xmb-top-right">
        <div className="xmb-clock">{formatTime(time)}</div>
        <div className="xmb-user-badge">
          {userAvatarUrl ? (
            <img
              src={userAvatarUrl}
              alt={userName}
              className="xmb-user-avatar"
            />
          ) : (
            <div className="xmb-user-avatar" />
          )}
          <div className="xmb-user-name">{userName}</div>
        </div>
      </div>

      <div className="xmb-selection-focus" />

      <div
        className="xmb-categories-container"
        style={{ transform: `translate(${-categoryIndex * CATEGORY_STEP_PX - CATEGORY_ACTIVE_HALF_WIDTH_PX}px, -50%)` }}
      >
        {TOP_CATEGORIES.map((cat, idx) => {
          const isActive = idx === categoryIndex;
          const { label } = getCategoryLabel(cat.id);
          return (
            <div key={cat.id} className={`xmb-category-item ${isActive ? 'active' : ''}`}>
              <div className="xmb-category-label">{label}</div>
            </div>
          );
        })}
      </div>

      {topCategory !== "settings" && topCategory !== "current" && (
      <div
        ref={itemsContainerRef}
        className="xmb-items-container"
        style={{
          transform: `translate(${-GAME_ACTIVE_CENTER_OFFSET_X_PX}px, ${listTranslateY}px)`,
        }}
      >
        {categorizedGames.map((game, idx) => {
          const isActive = idx === selectedIndex;
          const record = playtimeData[game.id];
          const totalSecs = record?.totalSeconds ?? 0;
          const lastPlayedAt = record?.lastPlayedAt ?? null;
          const sessionCount = record?.sessionCount ?? 0;
          const playtimeLabel = formatPlaytime(totalSecs);
          const lastPlayedLabel = formatLastPlayed(lastPlayedAt);
          const genres = game.genres?.slice(0, 2) ?? [];
          const tierLabel = game.membershipTierLabel;

          return (
            <div key={game.id} className={`xmb-game-item ${isActive ? 'active' : ''}`}>
              {favoriteGameIdSet.has(game.id) && (
              <Star className="xmb-game-favorite-icon" />
            )}
            <div className="xmb-game-poster-container">
                <img src={game.imageUrl} className="xmb-game-poster" />
            </div>
              <div className="xmb-game-info">
                <div className="xmb-game-title">{game.title}</div>

                <div className="xmb-game-meta">
                  {(() => {
                    const vId = selectedVariantByGameId[game.id] || game.variants[0]?.id;
                    const variant = game.variants.find(v => v.id === vId) || game.variants[0];
                    const storeName = getStoreDisplayName(variant?.store || "");
                    return storeName ? (
                      <span className="xmb-game-meta-chip xmb-game-meta-chip--store">{storeName}</span>
                    ) : null;
                  })()}

                  <span className="xmb-game-meta-chip xmb-game-meta-chip--playtime">
                    <Clock size={10} className="xmb-meta-icon" />
                    {playtimeLabel}
                  </span>

                  <span className="xmb-game-meta-chip xmb-game-meta-chip--last-played">
                    <Calendar size={10} className="xmb-meta-icon" />
                    {lastPlayedLabel}
                  </span>
                </div>

                {isActive && (
                  <div className="xmb-game-meta xmb-game-meta--expanded">
                    {sessionCount > 0 && (
                      <span className="xmb-game-meta-chip xmb-game-meta-chip--sessions">
                        <Repeat2 size={10} className="xmb-meta-icon" />
                        {sessionCount === 1 ? "1 session" : `${sessionCount} sessions`}
                      </span>
                    )}
                    {genres.map((g) => (
                      <span key={g} className="xmb-game-meta-chip xmb-game-meta-chip--genre">{sanitizeGenreName(g)}</span>
                    ))}
                    {tierLabel && (
                      <span className="xmb-game-meta-chip xmb-game-meta-chip--tier">{tierLabel}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {(topCategory === "settings" || topCategory === "current") && (
      <div
        ref={itemsContainerRef}
        className="xmb-items-container"
        style={{
          transform: `translate(${-GAME_ACTIVE_CENTER_OFFSET_X_PX}px, ${-selectedSettingIndex * 120}px)`,
        }}
      >
        {displayItems.map((item, idx) => {
          const isActive = idx === selectedSettingIndex;
          return (
            <div key={item.id} className={`xmb-game-item ${isActive ? 'active' : ''}`}>
              <div className="xmb-game-info">
                <div className="xmb-game-title">{item.label}</div>
                <div className="xmb-game-meta">
                  <span className="xmb-game-meta-chip">{item.value}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      <div className={`xmb-detail-layer ${selectedGame ? 'visible' : ''}`}>
          {topCategory === "current" && (
            <div className="xmb-current-detail">
              <div className="xmb-current-poster">
                <img src={pendingSwitchGameCover ?? currentStreamingGame?.imageUrl} alt={currentStreamingGame?.title ?? "Current"} />
              </div>
              <div className="xmb-current-info">
                <div className="xmb-game-title">{currentStreamingGame?.title ?? "Current Game"}</div>
              </div>
            </div>
          )}
          </div>

      <div className="xmb-footer">
        {topCategory === "current" ? (
          <>
            <div className="xmb-btn-hint"><ButtonA className="xmb-btn-icon" size={24} /> <span>Select</span></div>
            <div className="xmb-btn-hint" style={{flex: 1}}></div>
          </>
        ) : topCategory === "settings" ? (
          <>
            <div className="xmb-btn-hint"><ButtonX className="xmb-btn-icon" size={24} /> <span>Toggle</span></div>
            <div className="xmb-btn-hint" style={{flex: 1}}></div>
          </>
        ) : (
          <>
            <div className="xmb-btn-hint"><ButtonA className="xmb-btn-icon" size={24} /> <span>Start</span></div>
            <div className="xmb-btn-hint"><ButtonX className="xmb-btn-icon" size={24} /> <span>Store</span></div>
            <div className="xmb-btn-hint"><ButtonY className="xmb-btn-icon" size={24} /> <span>Favorite</span></div>
          </>
        )}
      </div>
    </div>
  );
}
