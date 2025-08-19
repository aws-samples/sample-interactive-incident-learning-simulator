package com.example.todoapp.domain;

import java.time.ZonedDateTime;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.todoapp.repository.TodoRepository;

@Service
@Transactional
public class TodoService {

    @Autowired
    private TodoRepository todoRepository;

    /**
     * 全てのToDoを取得します
     */
    public List<Todo> findAll() {
        return todoRepository.findAll();
    }

    /**
     * 指定されたIDのToDoを取得します
     */
    public Todo findById(Long id) {
        return todoRepository.findById(id).orElse(null);
    }

    /**
     * 新しいToDoを作成します
     */
    public Todo create(Todo todo) {
        ZonedDateTime now = ZonedDateTime.now();
        todo.setCreatedAt(now);
        todo.setUpdatedAt(now);
        return todoRepository.save(todo);
    }

    /**
     * ToDoを更新します
     */
    public Todo update(Todo todo) {
        Todo existingTodo = todoRepository.findById(todo.getId()).orElse(null);
        if (existingTodo != null) {
            existingTodo.setTitle(todo.getTitle());
            existingTodo.setCompleted(todo.isCompleted());
            existingTodo.setUpdatedAt(ZonedDateTime.now());
            return todoRepository.save(existingTodo);
        }
        return null;
    }

    /**
     * ToDoの完了状態を切り替えます
     */
    public Todo toggleComplete(Long id) {
        Todo todo = todoRepository.findById(id).orElse(null);
        if (todo != null) {
            todo.setCompleted(!todo.isCompleted());
            todo.setUpdatedAt(ZonedDateTime.now());
            return todoRepository.save(todo);
        }
        return null;
    }

    /**
     * ToDoを削除します
     */
    public void delete(Long id) {
        todoRepository.deleteById(id);
    }
}
