const express = require('express');
const { authenticateToken } = require('./auth');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const User = require('../models/User');

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const boards = await Board.find({
      $or: [{ owner: req.user.id }, { members: req.user.id }],
    })
      .populate('owner', 'name email')
      .sort({ createdAt: -1 });

    res.json({ boards });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { name, description } = req.body;

  try {
    const board = new Board({
      name,
      description: description || '',
      owner: req.user.id,
      members: [req.user.id],
    });

    await board.save();

    await User.findByIdAndUpdate(req.user.id, {
      $push: { boards: board._id },
    });

    res.status(201).json({ board });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const board = await Board.findById(req.params.id)
      .populate('owner', 'name email')
      .populate('members', 'name email')
      .populate({
        path: 'lists',
        populate: {
          path: 'cards',
          populate: {
            path: 'createdBy',
            select: 'name email',
          },
        },
      });

    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    if (
      board.owner.toString() !== req.user.id &&
      !board.members.some((m) => m._id.toString() === req.user.id)
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ board });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/invite', authenticateToken, async (req, res) => {
  const { email } = req.body;

  try {
    const board = await Board.findById(req.params.id);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    if (board.owner.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: 'Only board owner can invite users' });
    }

    const userToInvite = await User.findOne({ email });
    if (!userToInvite) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (board.members.includes(userToInvite._id)) {
      return res.status(400).json({ message: 'User already in board' });
    }

    if (!board.members) {
      board.members = [];
    }

    board.members.push(userToInvite._id);

    if (!userToInvite.boards) {
      userToInvite.boards = [];
    }

    userToInvite.boards.push(board._id);

    await board.save();
    await userToInvite.save();

    res.json({ message: 'User invited successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:boardId/lists', authenticateToken, async (req, res) => {
  const { boardId } = req.params;
  const { name } = req.body;

  try {
    const board = await Board.findById(boardId);
    if (
      !board ||
      (board.owner.toString() !== req.user.id &&
        !board.members.some((m) => m._id.toString() === req.user.id))
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!board.lists) {
      board.lists = [];
    }

    const listCount = await List.countDocuments({ board: boardId });
    const list = new List({
      name,
      board: boardId,
      position: listCount,
    });

    await list.save();

    board.lists.push(list._id);
    await board.save();

    res.status(201).json({ list });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post(
  '/:boardId/lists/:listId/cards',
  authenticateToken,
  async (req, res) => {
    const { boardId, listId } = req.params;
    const { title, description, dueDate } = req.body;

    try {
      const board = await Board.findById(boardId);
      const list = await List.findById(listId);

      if (!board || !list || list.board.toString() !== boardId) {
        return res.status(404).json({ message: 'Board or list not found' });
      }

      if (
        board.owner.toString() !== req.user.id &&
        !board.members.some((m) => m._id.toString() === req.user.id)
      ) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const cardCount = await Card.countDocuments({ list: listId });
      const card = new Card({
        title,
        description: description || '',
        list: listId,
        position: cardCount,
        dueDate: dueDate ? new Date(dueDate) : null,
        createdBy: req.user.id,
      });

      await card.save();

      if (!list.cards) {
        list.cards = [];
      }

      list.cards.push(card._id);
      await list.save();

      const populatedCard = await Card.findById(card._id).populate(
        'createdBy',
        'name email',
      );
      res.status(201).json({ card: populatedCard });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  },
);

router.patch('/cards/:id/move', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { newListId, position } = req.body;

  try {
    const card = await Card.findById(id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    const oldList = await List.findById(card.list);
    const newList = await List.findById(newListId);
    const board = await Board.findById(newList.board);

    if (!oldList || !newList || !board) {
      return res.status(404).json({ message: 'List or board not found' });
    }

    if (
      board.owner.toString() !== req.user.id &&
      !board.members.some((m) => m._id.toString() === req.user.id)
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await List.findByIdAndUpdate(oldList._id, {
      $pull: { cards: card._id },
    });

    await List.findByIdAndUpdate(newListId, {
      $push: { cards: card._id },
    });

    card.list = newListId;
    card.position = position || 0;
    await card.save();

    res.json({ card });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/recommendations', authenticateToken, async (req, res) => {
  try {
    const board = await Board.findById(req.params.id).populate({
      path: 'lists',
      populate: {
        path: 'cards',
      },
    });

    if (
      !board ||
      (board.owner.toString() !== req.user.id &&
        !board.members.some((m) => m._id.toString() === req.user.id))
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const recommendations = {
      alerts: [],
      priority: [],
      dueDate: [],
      status: [],
    };

    const allCards = [];
    board.lists.forEach((list) => {
      allCards.push(...list.cards);
    });

    const now = new Date();

    allCards.forEach((card) => {
      if (card.priority === 'Critical') {
        const criticalList = board.lists.find((l) =>
          l.name.toLowerCase().includes('in progress'),
        );
        if (
          criticalList &&
          !criticalList.cards.some(
            (c) => c._id.toString() === card._id.toString(),
          )
        ) {
          recommendations.priority.push({
            cardId: card._id,
            cardTitle: card.title,
            type: 'critical_priority',
            reason: 'Critical priority task should be in progress immediately',
            severity: 'high',
            action: 'Move to "In Progress" list',
          });
        }
      }

      if (card.priority === 'High') {
        const todoList = board.lists.find(
          (l) =>
            l.name.toLowerCase().includes('todo') ||
            l.name.toLowerCase().includes('backlog'),
        );
        if (
          todoList &&
          todoList.cards.some((c) => c._id.toString() === card._id.toString())
        ) {
          recommendations.priority.push({
            cardId: card._id,
            cardTitle: card.title,
            type: 'high_priority_waiting',
            reason: 'High priority task is waiting in backlog',
            severity: 'medium',
            action: 'Consider moving to "In Progress" if resources allow',
          });
        }
      }

      if (card.dueDate) {
        const dueDate = new Date(card.dueDate);
        const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

        if (daysUntilDue < 0) {
          if (card.status !== 'Done') {
            recommendations.dueDate.push({
              cardId: card._id,
              cardTitle: card.title,
              type: 'overdue',
              reason: `Task was due ${Math.abs(
                daysUntilDue,
              )} day(s) ago but is not completed`,
              severity: card.priority === 'Critical' ? 'high' : 'medium',
              action:
                card.status === 'Blocked'
                  ? 'Resolve blocking issues and complete task'
                  : 'Complete task immediately',
            });
          }
        } else if (daysUntilDue <= 2) {
          if (card.status !== 'Done' && card.status !== 'In Progress') {
            recommendations.dueDate.push({
              cardId: card._id,
              cardTitle: card.title,
              type: 'due_soon',
              reason: `Task is due in ${daysUntilDue} day(s) but not yet in progress`,
              severity: card.priority === 'Critical' ? 'high' : 'medium',
              action: 'Move to "In Progress" and prioritize completion',
            });
          }
        } else if (daysUntilDue <= 7 && card.status === 'Backlog') {
          recommendations.dueDate.push({
            cardId: card._id,
            cardTitle: card.title,
            type: 'upcoming_deadline',
            reason: `Task due in ${daysUntilDue} days is still in backlog`,
            severity: 'low',
            action: 'Consider starting work or adjusting timeline',
          });
        }
      } else {
        if (card.priority === 'Critical' || card.priority === 'High') {
          recommendations.dueDate.push({
            cardId: card._id,
            cardTitle: card.title,
            type: 'no_due_date_high_priority',
            reason: `${card.priority} priority task has no due date`,
            severity: card.priority === 'Critical' ? 'medium' : 'low',
            action: 'Set a realistic due date for proper planning',
          });
        }
      }

      const currentListIndex = board.lists.findIndex((l) =>
        l.cards.some((c) => c._id.toString() === card._id.toString()),
      );
      const currentList = board.lists[currentListIndex];

      if (card.status === 'In Progress') {
        if (card.dueDate) {
          const dueDate = new Date(card.dueDate);
          const daysUntilDue = Math.ceil(
            (dueDate - now) / (1000 * 60 * 60 * 24),
          );

          if (daysUntilDue < 0) {
            recommendations.status.push({
              cardId: card._id,
              cardTitle: card.title,
              type: 'in_progress_overdue',
              reason: 'Task is in progress but past due date',
              severity: 'high',
              action: 'Complete immediately or escalate',
            });
          } else if (daysUntilDue <= 1) {
            recommendations.status.push({
              cardId: card._id,
              cardTitle: card.title,
              type: 'in_progress_due_soon',
              reason: `In progress task due in ${daysUntilDue} day(s)`,
              severity: 'medium',
              action: 'Focus on completing this task',
            });
          }
        }
      }

      if (card.status === 'Blocked') {
        recommendations.status.push({
          cardId: card._id,
          cardTitle: card.title,
          type: 'blocked_task',
          reason: 'Task is blocked and needs attention',
          severity: 'medium',
          action: 'Identify and resolve blocking issues',
        });
      }

      if (card.status === 'Todo' && card.priority === 'Critical') {
        recommendations.status.push({
          cardId: card._id,
          cardTitle: card.title,
          type: 'critical_in_todo',
          reason: 'Critical priority task should not remain in Todo',
          severity: 'high',
          action: 'Move to "In Progress" immediately',
        });
      }

      if (
        card.status === 'Done' &&
        !currentList.name.toLowerCase().includes('done')
      ) {
        const doneList = board.lists.find(
          (l) =>
            l.name.toLowerCase().includes('done') ||
            l.name.toLowerCase().includes('complete'),
        );
        if (doneList) {
          recommendations.alerts.push({
            cardId: card._id,
            cardTitle: card.title,
            type: 'move_to_done',
            reason: 'Completed task should be moved to Done list',
            severity: 'low',
            action: 'Move to completed tasks list',
          });
        }
      }
    });

    const allRecommendations = [
      ...recommendations.alerts,
      ...recommendations.priority,
      ...recommendations.dueDate,
      ...recommendations.status,
    ].sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    res.json({ recommendations: allRecommendations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/cards/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const card = await Card.findById(id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    const list = await List.findById(card.list);
    const board = await Board.findById(list.board);

    if (
      board.owner.toString() !== req.user.id &&
      !board.members.some((m) => m._id.toString() === req.user.id)
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (updates.dueDate) {
      updates.dueDate = new Date(updates.dueDate);
    }

    const updatedCard = await Card.findByIdAndUpdate(id, updates, {
      new: true,
    }).populate('createdBy', 'name email');

    res.json({ card: updatedCard });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
