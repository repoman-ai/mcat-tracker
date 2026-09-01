/** Daily records sync last-write-wins per day, including completion and undo. */
export function withDailyStatus(state, id, status) {
  return {
    ...state,
    daily: {
      ...state.daily,
      [id]: { ...state.daily[id], status, updatedAt: new Date().toISOString() },
    },
  };
}
