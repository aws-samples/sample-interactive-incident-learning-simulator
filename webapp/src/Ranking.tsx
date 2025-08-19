import React, { useState, useEffect } from "react";
import "./TimerApp.css";

interface RankingItem {
  time: string;
  timer: number;
  mode: string;
  pattern?: string; // patternフィールドを追加（オプショナル）
}

interface RankingTableProps {
  easyRankings: RankingItem[];
  hardRankings: RankingItem[];
}

const formatTime = (time: number) => {
  const minutes = Math.floor(time / 60000);
  const seconds = Math.floor((time % 60000) / 1000);
  const milliseconds = Math.floor((time % 1000) / 10);

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}`;
};

const RankingTable: React.FC<RankingTableProps> = ({
  easyRankings,
  hardRankings,
}) => {
  return (
    <div className="ranking-container">
      <div className="combined-rankings">
        <div className="ranking-mode">
          <h3>Easy Mode</h3>
          <table className="ranking-table">
            <thead>
              <tr>
                <th>順位</th>
                <th>タイム</th>
              </tr>
            </thead>
            <tbody>
              {easyRankings.length > 0 ? (
                easyRankings.map((item, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{formatTime(item.timer)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>記録がありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="ranking-mode">
          <h3>Hard Mode</h3>
          <table className="ranking-table">
            <thead>
              <tr>
                <th>順位</th>
                <th>タイム</th>
              </tr>
            </thead>
            <tbody>
              {hardRankings.length > 0 ? (
                hardRankings.map((item, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{formatTime(item.timer)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>記録がありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface RankingProps {
  apiEndpoint: string;
  onRecordAdded?: boolean;
  pattern: string;
  apiRecordapiKey: string;
}

const Ranking: React.FC<RankingProps> = ({
  apiEndpoint,
  onRecordAdded,
  pattern,
  apiRecordapiKey,
}) => {
  const [easyRankings, setEasyRankings] = useState<RankingItem[]>([]);
  const [hardRankings, setHardRankings] = useState<RankingItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // ランキングデータを取得
  const fetchRankings = async () => {
    setIsLoading(true);
    try {
      let easyAllArray: RankingItem[] = [];
      let hardAllArray: RankingItem[] = [];

      if (pattern === "Security") {
        const response = await fetch(
          `${apiEndpoint}get-rankings?mode=security`,
          {
            headers: {
              Authorization: apiRecordapiKey,
            },
          },
        );

        const responseData = await response.json();
        easyAllArray = responseData.Easy;
        hardAllArray = responseData.Hard;
      } else if (pattern === "Resiliency") {
        const response = await fetch(
          `${apiEndpoint}get-rankings?mode=resiliency`,
          {
            headers: {
              Authorization: apiRecordapiKey,
            },
          },
        );

        const responseData = await response.json();
        easyAllArray = responseData.Easy;
        hardAllArray = responseData.Hard;
      }

      setEasyRankings(easyAllArray);
      setHardRankings(hardAllArray);
    } catch (error) {
      console.error("ランキング取得エラー:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // コンポーネントのマウント時にランキングを取得
  useEffect(() => {
    fetchRankings();
  }, []);

  // 記録が追加されたときにランキングを更新
  useEffect(() => {
    if (onRecordAdded) {
      console.log("ログ: レコードの再取得");
      fetchRankings();
    }
  }, [onRecordAdded]);

  return (
    <div className="rankings-section">
      {isLoading ? (
        <p>ランキングを読み込み中...</p>
      ) : (
        <RankingTable easyRankings={easyRankings} hardRankings={hardRankings} />
      )}
      {/* <button 
        onClick={fetchRankings}
        className="refresh-button"
      >
        ランキング更新
      </button> */}
    </div>
  );
};

export default Ranking;
export { formatTime };
