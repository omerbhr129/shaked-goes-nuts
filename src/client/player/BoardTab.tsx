import { motion } from "motion/react";
import type { ClientView } from "../../shared/types";
import { cls, kingAndLast, ranked } from "../lib";
import { Avatar, Change, Money, Podium, Spark } from "../ui";

export function BoardTab({ view, meId }: { view: ClientView; meId: string }) {
  const list = ranked(view.pub.players);
  const start = view.pub.settings.startBalance;
  const { king, last } = kingAndLast(view.pub.players);
  return (
    <section className="stack">
      <h2 className="board-title">טבלת המסחר</h2>
      <div className="board-podium felt">
        <Podium list={list.slice(0, 3)} size="s" />
      </div>
      <p className="board-rules">👑 המלך בוחר מי מתמודד באתגר הבא. 🍋 השקד המר שותה כשהגלגל מחליט.</p>
      <ol className="board-list">
        {list.map((p, i) => (
          <motion.li layout transition={{ type: "spring", stiffness: 260, damping: 30 }} key={p.id} className={cls("board-row", p.id === meId && "me", i === 0 && "lead")}>
            <span className="board-rank num">{i + 1}</span>
            <Avatar p={p} size={42} badge={p.id === king ? "👑" : p.id === last ? "🍋" : null} />
            <span className="board-name">
              {p.name}
              <small>{p.ticker}</small>
            </span>
            <Spark data={p.spark} w={58} h={26} />
            <span className="board-bal">
              <Money n={p.balance} size={15} />
              <Change balance={p.balance} start={start} />
            </span>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}
