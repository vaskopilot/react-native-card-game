import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import { db } from "@/firebaseConfig";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";
import avatars from "@/utils/avatarLoader";

SplashScreen.preventAutoHideAsync();

const suitSymbols = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };
const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const MAX_CARDS = 10;
const groupColors = ["#FF5733", "#33FF57", "#3357FF", "#FF33A8", "#A833FF", "#33FFF3"];

function getCardValues(card) {
  if (card.rank === "A") return [1, 11];
  if (card.rank === "J") return [12];
  if (card.rank === "Q") return [13];
  if (card.rank === "K") return [14];
  return [parseInt(card.rank)];
}

function generateDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isConsecutive(card1, card2) {
  if (card1.suit !== card2.suit) return false;
  const vals1 = getCardValues(card1);
  const vals2 = getCardValues(card2);
  for (const v1 of vals1) {
    for (const v2 of vals2) {
      if (v2 - v1 === 1) return true;
    }
  }
  return false;
}

function computeGroups(hand) {
  const groups = [];
  let i = 0;
  while (i < hand.length) {
    let j = i + 1;
    while (j < hand.length && hand[j].rank === hand[i].rank) {
      j++;
    }
    if (j - i >= 2) {
      groups.push({
        indices: Array.from({ length: j - i }, (_, k) => i + k),
        type: "set",
      });
    }
    i = j;
  }
  i = 0;
  while (i < hand.length) {
    const groupIndices = [i];
    while (i < hand.length - 1 && isConsecutive(hand[i], hand[i + 1])) {
      groupIndices.push(i + 1);
      i++;
    }
    if (groupIndices.length >= 2) {
      groups.push({ indices: groupIndices, type: "run" });
    }
    i++;
  }
  return groups;
}

export default function GameScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { roomId, playerId } = useLocalSearchParams();

  // Fixed sizes
  const cardSize = { width: 80, height: 110 };
  const avatarContainerSize = { width: 100, height: 120 };

  const [deck, setDeck] = useState([]);
  const [discardPile, setDiscardPile] = useState([]);
  const [playerHand, setPlayerHand] = useState([]);
  const [displayHand, setDisplayHand] = useState([]);
  const [currentRound, setCurrentRound] = useState(1); // Change to 0 if you want first round to be 1 on start
  const [roundStatus, setRoundStatus] = useState("waiting");
  const [players, setPlayers] = useState([]);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [hasDrawnCard, setHasDrawnCard] = useState(false);
  const [selectedCardIndex, setSelectedCardIndex] = useState(null);
  const [discardMode, setDiscardMode] = useState(false);
  const [rumpMode, setRumpMode] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    const gameRef = doc(db, "games", roomId);
    const unsubscribe = onSnapshot(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setPlayers(data.players || []);
        setCurrentRound(data.currentRound || 0);
        if (data.deck) setDeck(data.deck);
        if (data.discardPile) setDiscardPile(data.discardPile);
        if (data.hands && data.hands[playerId]) {
          const newHand = data.hands[playerId];
          setPlayerHand(newHand);
          // Only update displayHand if the lengths differ
          if (!displayHand.length || displayHand.length !== newHand.length) {
            setDisplayHand(newHand);
          }
        }
        if (data.hostId === playerId) {
          setIsHost(true);
        }
        if (data.currentTurn) {
          setCurrentTurn(data.currentTurn);
          if (data.currentTurn !== currentTurn) {
            setHasDrawnCard(false);
          }
        }
        setRoundStatus(data.roundStatus || "waiting");
      } else {
        Alert.alert("Game session not found!");
        router.replace("/lobby");
      }
    });
    return () => unsubscribe();
  }, [roomId, currentTurn, playerId, displayHand.length, router]);

  const initializeRound = async () => {
    if (!isHost) return;
    if (players.length === 0) {
      Alert.alert("No players available to start the round.");
      return;
    }
    // If you want the game to start at Round 1, you can either initialize currentRound as 0
    // or update this logic to not add 1 on the first round.
    if (currentRound >= 11) {
      await updateDoc(doc(db, "games", roomId), { roundStatus: "gameOver" });
      setRoundStatus("gameOver");
      return;
    }
    const newDeck = shuffleArray(generateDeck());
    const hands = {};
    players.forEach((player) => {
      hands[player.id] = newDeck.splice(0, 9);
    });
    await updateDoc(doc(db, "games", roomId), {
      deck: newDeck,
      discardPile: [],
      hands,
      currentRound: currentRound + 1, // This increments the round number.
      roundStatus: "started",
      currentTurn: players[0]?.id,
    });
    setRoundStatus("started");
    setHasDrawnCard(false);
  };

  const drawCard = async (sourceKey) => {
    const source = sourceKey === "deck" ? deck : discardPile;
    if (playerId !== currentTurn) {
      Alert.alert("Not your turn!");
      return;
    }
    if (hasDrawnCard) {
      Alert.alert("You've already drawn a card this turn!");
      return;
    }
    if (source.length === 0) {
      Alert.alert(sourceKey === "deck" ? "The deck is empty!" : "The discard pile is empty!");
      return;
    }
    if (playerHand.length >= MAX_CARDS) {
      Alert.alert(`You can only have ${MAX_CARDS} cards in your hand. Please discard first.`);
      return;
    }
    const drawnCard = sourceKey === "deck" ? source[0] : source[source.length - 1];
    const newSource = sourceKey === "deck" ? source.slice(1) : source.slice(0, -1);
    const newHand = [...playerHand, drawnCard];
    setPlayerHand(newHand);
    await updateDoc(doc(db, "games", roomId), {
      [sourceKey]: newSource,
      [`hands.${playerId}`]: newHand,
    });
    setHasDrawnCard(true);
  };

  const drawFromDeck = useCallback(() => drawCard("deck"), [deck, playerHand, hasDrawnCard, currentTurn]);
  const drawFromDiscard = useCallback(() => drawCard("discardPile"), [discardPile, playerHand, hasDrawnCard, currentTurn]);

  const discardCard = async (index) => {
    if (playerId !== currentTurn) {
      Alert.alert("Not your turn!");
      return;
    }
    const cardToDiscard = displayHand[index];
    const cardIndex = playerHand.findIndex(
      (card) =>
        card.rank === cardToDiscard.rank && card.suit === cardToDiscard.suit
    );
    if (cardIndex === -1) {
      Alert.alert("Error: Card not found");
      return;
    }
    const newHand = [...playerHand];
    const discardedCard = newHand.splice(cardIndex, 1)[0];
    const newDisplayHand = [...displayHand];
    newDisplayHand.splice(index, 1);
    setDisplayHand(newDisplayHand);
    const currentPlayerIndex = players.findIndex((player) => player.id === playerId);
    const nextPlayerIndex = (currentPlayerIndex + 1) % players.length;
    const nextPlayerId = players[nextPlayerIndex]?.id;
    await updateDoc(doc(db, "games", roomId), {
      [`hands.${playerId}`]: newHand,
      discardPile: [...discardPile, discardedCard],
      currentTurn: nextPlayerId,
    });
    setHasDrawnCard(false);
  };

  const handleCardPress = useCallback(
    (index) => {
      if (discardMode) {
        discardCard(index);
        setDiscardMode(false);
      } else {
        if (selectedCardIndex === index) {
          setSelectedCardIndex(null);
        } else if (selectedCardIndex !== null) {
          const newDisplayHand = [...displayHand];
          const [card] = newDisplayHand.splice(selectedCardIndex, 1);
          newDisplayHand.splice(index, 0, card);
          // Update both local states with the new order
          setDisplayHand(newDisplayHand);
          setPlayerHand(newDisplayHand);
          // Sync the new hand order to Firebase
          updateDoc(doc(db, "games", roomId), {
            [`hands.${playerId}`]: newDisplayHand,
          }).catch((err) => console.error("Failed to update hand order", err));
          setSelectedCardIndex(null);
        } else {
          setSelectedCardIndex(index);
        }
      }
    },
    [discardMode, displayHand, selectedCardIndex, roomId, playerId]
  );

  const canToggleDiscard = playerId === currentTurn && hasDrawnCard && !rumpMode;
  const canToggleRump = playerId === currentTurn && hasDrawnCard && !discardMode;

  // Compute highlightMapping using useMemo
  const highlightMapping = useMemo(() => {
    const mapping = {};
    const groups = computeGroups(displayHand);
    groups.forEach((group, i) => {
      group.indices.forEach(index => {
        mapping[index] = groupColors[i % groupColors.length];
      });
    });
    return mapping;
  }, [displayHand]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {isHost && roundStatus === "waiting" && (
          <TouchableOpacity style={styles.startRoundButton} onPress={initializeRound}>
            <Text style={styles.startRoundText}>Start Round</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.header, { color: colors.text }]}>
          {roundStatus === "gameOver" ? "Game Over" : `Round ${currentRound}`}
        </Text>
        <View style={styles.avatarRow}>
          {players.map((player) => (
            <View
              key={player.id}
              style={[
                styles.avatarContainer,
                avatarContainerSize,
                player.id === currentTurn && styles.currentTurnHighlight,
              ]}
            >
              <Image source={avatars[player.avatar]} style={styles.avatarImage} />
              <Text style={[styles.avatarName, player.id === currentTurn && styles.currentTurnAvatarName]}>
                {player.name}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.deckDiscardContainer}>
          <View style={styles.deckColumn}>
            <TouchableOpacity
              onPress={drawFromDeck}
              style={[
                styles.deckCard,
                (hasDrawnCard || playerHand.length >= MAX_CARDS) && styles.disabledDeck,
              ]}
              disabled={hasDrawnCard || playerHand.length >= MAX_CARDS}
            >
              <Text style={styles.cardText}>Deck ({deck.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.rumpButton,
                !canToggleRump && styles.disabledButton,
                rumpMode ? { backgroundColor: "#a00" } : { backgroundColor: "#ccc" },
              ]}
              onPress={() => {
                if (!canToggleRump) {
                  Alert.alert("You cannot toggle Rump mode right now!");
                  return;
                }
                setRumpMode(!rumpMode);
                if (!rumpMode) setDiscardMode(false);
              }}
              disabled={!canToggleRump}
            >
              <Text
                style={[
                  styles.rumpButtonText,
                  !canToggleRump && styles.disabledButton,
                  rumpMode ? { color: "#fff" } : { color: "#000" },
                ]}
              >
                Rump
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.discardColumn}>
            <TouchableOpacity
              onPress={drawFromDiscard}
              style={[
                styles.deckCard,
                (hasDrawnCard || discardPile.length === 0 || playerHand.length >= MAX_CARDS) &&
                  styles.disabledDeck,
              ]}
              disabled={hasDrawnCard || discardPile.length === 0 || playerHand.length >= MAX_CARDS}
            >
              {discardPile.length > 0 ? (
                <View style={styles.card}>
                  <Text
                    style={[
                      styles.cardText,
                      {
                        color: ["hearts", "diamonds"].includes(discardPile[discardPile.length - 1].suit)
                          ? "red"
                          : "black",
                      },
                    ]}
                  >
                    {discardPile[discardPile.length - 1].rank}{" "}
                    {suitSymbols[discardPile[discardPile.length - 1].suit]}
                  </Text>
                </View>
              ) : (
                <Text style={styles.cardText}>Empty Discard</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.discardButton,
                !canToggleDiscard && styles.disabledButton,
                discardMode ? { backgroundColor: "#a00" } : { backgroundColor: "#ccc" },
              ]}
              onPress={() => {
                if (!canToggleDiscard) {
                  Alert.alert("You cannot toggle Discard mode right now!");
                  return;
                }
                setDiscardMode(!discardMode);
                if (!discardMode) setRumpMode(false);
              }}
              disabled={!canToggleDiscard}
            >
              <Text
                style={[
                  styles.discardButtonText,
                  !canToggleDiscard && styles.disabledButton,
                  discardMode ? { color: "#fff" } : { color: "#000" },
                ]}
              >
                Discard
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.handContainer}>
          {displayHand.map((card, index) => {
            const comboStyle = highlightMapping[index]
              ? { borderColor: highlightMapping[index], borderWidth: 3 }
              : null;
            return (
              <TouchableOpacity
                key={`${card.rank}-${card.suit}-${index}`}
                style={[
                  styles.card,
                  cardSize,
                  selectedCardIndex === index && styles.selectedCard,
                  comboStyle,
                ]}
                onPress={() => handleCardPress(index)}
              >
                <Text
                  style={[
                    styles.cardText,
                    { color: ["hearts", "diamonds"].includes(card.suit) ? "red" : "black" },
                  ]}
                >
                  {card.rank} {suitSymbols[card.suit]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 10 },
  content: {
    flex: 1,
    justifyContent: "flex-start", // Items start at the top
    alignItems: "center",           // Center items horizontally
    paddingVertical: 20,            // Add vertical padding for breathing room
  },
  startRoundButton: {
    padding: 10,
    borderRadius: 3,
    backgroundColor: "#c3c3c3",
    alignSelf: "center",
    borderWidth: 4,
    borderLeftColor: "#fff",
    borderTopColor: "#fff",
    borderRightColor: "#404040",
    borderBottomColor: "#404040",
    marginBottom: 10,
  },
  startRoundText: { color: "#fff", fontFamily: "PressStart2P", fontSize: 14 },
  header: { fontSize: 20, fontFamily: "PressStart2P", textAlign: "center", marginBottom: 10 },
  avatarRow: { flexDirection: "row", justifyContent: "center", marginBottom: 10 },
  avatarContainer: {
    alignItems: "center",
    padding: 5,
    backgroundColor: "#c3c3c3",
    borderWidth: 4,
    borderLeftColor: "#fff",
    borderTopColor: "#fff",
    borderRightColor: "#404040",
    borderBottomColor: "#404040",
    marginHorizontal: 5,
  },
  currentTurnHighlight: { backgroundColor: "#9e9572" },
  avatarImage: {
    width: "100%",
    height: "80%",
    borderWidth: 4,
    borderTopColor: "#404040",
    borderLeftColor: "#404040",
    borderBottomColor: "#fff",
    borderRightColor: "#fff",
  },
  avatarName: { fontFamily: "PressStart2P", fontSize: 10, marginTop: 5, color: "#000" },
  currentTurnAvatarName: { color: "yellow" },
  deckDiscardContainer: { flexDirection: "row", justifyContent: "space-evenly", marginVertical: 10 },
  deckColumn: {
    alignItems: "center",
  },
  deckCard: {
    width: 80,
    height: 110,
    backgroundColor: "#444",
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
  },
  disabledDeck: { backgroundColor: "#777", opacity: 0.6 },
  discardColumn: { alignItems: "center" },
  discardButton: {
    padding: 10,
    marginTop: 10,
    borderRadius: 3,
    borderWidth: 4,
    borderLeftColor: "#fff",
    borderTopColor: "#fff",
    borderRightColor: "#404040",
    borderBottomColor: "#404040",
  },
  discardButtonText: { color: "#000", fontFamily: "PressStart2P", fontSize: 12 },
  disabledButton: { opacity: 0.5 },
  rumpButton: {
    padding: 10,
    marginTop: 10,
    borderRadius: 3,
    borderWidth: 4,
    borderLeftColor: "#fff",
    borderTopColor: "#fff",
    borderRightColor: "#404040",
    borderBottomColor: "#404040",
  },
  rumpButtonText: { color: "#000", fontFamily: "PressStart2P", fontSize: 12, textAlign: "center" },
  handContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#c3c3c3",
    borderWidth: 4,
    borderLeftColor: "#fff",
    borderTopColor: "#fff",
    borderRightColor: "#404040",
    borderBottomColor: "#404040",
    borderRadius: 3,
  },
  card: {
    backgroundColor: "#fff",
    borderColor: "#000",
    borderWidth: 1,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
    margin: 5,
  },
  selectedCard: { backgroundColor: "#ffffd0", borderColor: "#ff8800", borderWidth: 2 },
  cardText: { fontFamily: "PressStart2P", fontSize: 12, textAlign: "center" },
});
