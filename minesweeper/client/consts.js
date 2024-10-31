const { Binomial } = require("../utility/binomial")

const ACTION_CLEAR = 1
const ACTION_FLAG = 2
const ACTION_CHORD = 3

const WON = "won"
const LOST = "lost"
const IN_PLAY = "in-play"

const BINOMIAL = new Binomial(70000, 500)

module.exports = {
    ACTION_CLEAR,
    ACTION_FLAG,
    ACTION_CHORD,

    WON,
    LOST,
    IN_PLAY,

    BINOMIAL,
}
