package com.example.todoapp.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import com.example.todoapp.domain.Todo;
import com.example.todoapp.domain.TodoService;

@Controller
@RequestMapping(value={"/todos","/"})
public class TodoController {

    @Autowired
    private TodoService todoService;

    /**
     * ToDo一覧を表示します
     */
    @GetMapping
    public String list(Model model) {
        model.addAttribute("todos", todoService.findAll());
        return "todo/list";
    }

    /**
     * ToDo作成フォームを表示します
     */
    @GetMapping("/new")
    public String newTodo(Model model) {
        model.addAttribute("todo", new Todo());
        return "todo/form";
    }

    /**
     * ToDoを作成します
     */
    @PostMapping
    public String create(Todo todo) {
        todoService.create(todo);
        return "redirect:/todos";
    }

    /**
     * ToDo編集フォームを表示します
     */
    @GetMapping("/{id}/edit")
    public String edit(@PathVariable Long id, Model model) {
        Todo todo = todoService.findById(id);
        model.addAttribute("todo", todo);
        return "todo/form";
    }

    /**
     * ToDoを更新します
     */
    @PostMapping("/{id}")
    public String update(@PathVariable Long id, Todo todo) {
        todo.setId(id);
        todoService.update(todo);
        return "redirect:/todos";
    }

    /**
     * ToDoを削除します
     */
    @PostMapping("/{id}/delete")
    public String delete(@PathVariable Long id) {
        todoService.delete(id);
        return "redirect:/todos";
    }

    /**
     * ToDoの完了状態を切り替えます
     */
    @PostMapping("/{id}/toggle")
    public String toggleComplete(@PathVariable Long id) {
        todoService.toggleComplete(id);
        return "redirect:/todos";
    }
}
