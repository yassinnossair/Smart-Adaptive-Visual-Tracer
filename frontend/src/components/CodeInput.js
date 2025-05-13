import React, { useState, useEffect } from 'react';
import { Form, Button, Alert, Spinner, Row, Col, ButtonGroup, Dropdown } from 'react-bootstrap';
import axios from 'axios';
import './CodeInput.css'; // Ensure this CSS is adjusted if new styles are needed

function CodeInput({ onAnalysisComplete }) {
  // Initial code can be blank or a very simple placeholder now
  const initialCode = `# Welcome to the Smart Adaptive Visual Tracer!
# Select an example from the buttons below or write your own Python code.`;

  const [code, setCode] = useState(initialCode);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // --- Placeholder for example code snippets ---
  // You will replace these comments with actual code strings
  const exampleSnippets = {
    timelineArray: [
      `# Code for Timeline Array Example 1\n
numbers = [5, 10, 15, 20, 25]
for i in range(3):
    if i % 2 == 0:
        numbers.append(30 + i * 5)
    else:
        numbers.insert(0, i)
i = len(numbers) - 1
while i >= 0:
    if numbers[i] % 10 == 0:
        numbers.pop(i)
    i -= 1
mid_index = len(numbers) // 2
for i in range(len(numbers)):
    if i < mid_index:
        numbers[i] = numbers[i] * 2
sum_val = 0
for i in range(min(3, len(numbers))):
    sum_val += numbers[i]
numbers.append(sum_val)`,
      `# Code for Timeline Array Example 2\n
items = ["apple", "banana"]
items.insert(1, "orange")
items.append("grape")
items.append("kiwi")
items.reverse()
i = 0
while i < len(items):
    if len(items[i]) > 5:
        items.pop(i)
    else:
        i += 1`,
      `# Code for Timeline Array Example 3\n
data_set = []
for i in range(8):
    data_set.append(i * i)
i = len(data_set) - 1
while i >= 0:
    if data_set[i] % 2 != 0:
        data_set.pop(i)
    i -= 1
data_set.insert(0, -1)
data_set.append(100)
if len(data_set) > 4:
    data_set[3] = data_set[3] * 2
data_set.pop(0)`,
      `# Code for Timeline Array Example 4\n
queue = [10]
for step in range(1, 6):
    current_len = len(queue)
    if current_len < 5:
        queue.append(step * 100)
        queue.append(step * 100 + 1)
    else:
        if current_len >= 4:
            mid = current_len // 2 - 1
            queue.pop(mid)
            queue.pop(mid)
        else:
            queue.pop(0)`,
      `# Code for Timeline Array Example 5\n
numbers = [5, 10, 15, 20, 25 , 30 , 40 , 50 , 60]
def recursive_modifier(numbers, depth, max_depth):
    if depth >= max_depth or not numbers:
        return
    if depth % 2 == 0:
        if numbers:
            removed_element = numbers.pop()
    else:
        if numbers:
            numbers[0] = numbers[0] * 3
    recursive_modifier(numbers, depth + 1, max_depth)
for i in range(3):
    if i % 2 == 0:
        numbers.append(70 + i * 5)
    else:
        numbers.insert(0, i)
recursive_modifier(numbers, 0, 20)`
    ],
    elementFocusedArray: [
      `# Code for Element Focused Array Example 1 (Bubble Sort)\n
bubble_data = [5, 1, 4, 2, 8]
n = len(bubble_data)
swapped = False
for i in range(n - 1):
    swapped = False
    for j in range(n - i - 1):
        if bubble_data[j] > bubble_data[j + 1]:
            temp = bubble_data[j]
            bubble_data[j] = bubble_data[j + 1]
            bubble_data[j + 1] = temp
            swapped = True
    if not swapped:
        break`,
      `# Code for Element Focused Array Example 2 (Selection Sort)\n
selection_data = [64, 25, 12, 22, 11]
length = len(selection_data)
for i in range(length - 1):
    min_idx = i
    for j in range(i + 1, length):
        if selection_data[j] < selection_data[min_idx]:
            min_idx = j
    if min_idx != i:
        temp = selection_data[min_idx]
        selection_data[min_idx] = selection_data[i]
        selection_data[i] = temp`,
      `# Code for Element Focused Array Example 3 (Insertion Sort)\n
insertion_data = [12, 11, 13, 5, 6]
n = len(insertion_data)
for i in range(1, n):
    key = insertion_data[i]
    j = i - 1
    while j >= 0 and insertion_data[j] > key:
        insertion_data[j + 1] = insertion_data[j]
        j = j - 1
    if insertion_data[j + 1] != key:
        insertion_data[j + 1] = key`,
      `# Code for Element Focused Array Example 4\n
values = [2, 7, 3, 8, 4, 9]
for i in range(len(values)):
    if values[i] % 2 == 0:
        values[i] = values[i] * 2
    else:
        values[i] = values[i] + i`
    ],
    arrayComparison: [
      `# Code for Array Comparison Example 1\n
original_data = [1, 2, 3, 4, 5, 6, 7, 8]
even_numbers = []
odd_numbers = []
squared_numbers = []
for i in range(len(original_data)):
    num = original_data[i]
    squared_numbers.append(num * num)
    if num % 2 == 0:
        even_numbers.append(num)
    else:
        odd_numbers.append(num)
original_data.pop(0)
original_data.pop(0)
original_data.append(9)
if odd_numbers: odd_numbers.pop() # Check if not empty
for i in range(len(squared_numbers)):
    if i % 3 == 0:
        squared_numbers[i] = 0`,
      `# Code for Array Comparison Example 2\n
source_data = [5, -2, 8, -1, 0, 4, -3, 9]
positives = []
negatives = []
merged_result = []
for i in range(len(source_data)):
    if source_data[i] >= 0:
        positives.append(source_data[i])
    else:
        negatives.append(source_data[i])
if source_data: source_data.pop(0) # Check if not empty
if len(positives) > 1: positives[1] = 100
negatives.append(-10)
merged_result = negatives[0:min(2, len(negatives))] + positives[1:min(3, len(positives))]
merged_result.append(99)`,
      `# Code for Array Comparison Example 3\n
list_a = ['P', 'Q', 'R', 'S']
list_b = [10, 20, 30, 40, 50]
interleaved = []
len_a = len(list_a)
len_b = len(list_b)
max_len = max(len_a, len_b)
for i in range(max_len):
    if i < len_a:
        interleaved.append(list_a[i])
    if i < len_b:
        interleaved.append(list_b[i])
list_a.append('T')
if list_b: list_b[0] = 15
if len(interleaved) > 1: interleaved.pop(1)
if len(interleaved) > 1: interleaved.pop(1)
interleaved.insert(1, 'X')
if interleaved: interleaved.pop()`,
       `# Code for Array Comparison Example 4\n
numbers = [3, -1, 4, 1, -5, 2]
cumulative_sums = []
positive_sums = []
current_sum = 0
for i in range(len(numbers)):
    current_sum += numbers[i]
    cumulative_sums.append(current_sum)
if len(numbers) > 2 : numbers[2] = 0
numbers.append(10)
for i in range(len(cumulative_sums)):
    if cumulative_sums[i] > 0:
        positive_sums.append(cumulative_sums[i])
if cumulative_sums: cumulative_sums.pop(0)
if positive_sums: positive_sums[0] = 1`
    ],
    hierarchicalTree: [
      `# Hierarchical Tree Examples Code
# Example 1
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

# Create a Binary Search Tree with insertions
def insert_node(root, value):
    if root is None:
        return TreeNode(value)
    
    if value < root.value:
        root.left = insert_node(root.left, value)
    else:
        root.right = insert_node(root.right, value)
    
    return root

# Create the initial tree
root = TreeNode(50)
values_to_insert = [30, 70, 20, 40, 60, 80, 15, 25, 35, 45, 55, 65, 75, 85]

for value in values_to_insert:
    insert_node(root, value)

# Add additional subtrees to make it complex
root.left.left.left.left = TreeNode(10)
root.left.left.left.right = TreeNode(17)
root.left.left.right.left = TreeNode(22)
root.left.left.right.right = TreeNode(27)
root.left.right.left.left = TreeNode(32)
root.left.right.left.right = TreeNode(37)
root.left.right.right.left = TreeNode(42)
root.left.right.right.right = TreeNode(47)
root.right.left.left.left = TreeNode(52)
root.right.left.left.right = TreeNode(57)
root.right.left.right.left = TreeNode(62)
root.right.left.right.right = TreeNode(67)
root.right.right.left.left = TreeNode(72)
root.right.right.left.right = TreeNode(77)
root.right.right.right.left = TreeNode(82)
root.right.right.right.right = TreeNode(87)

# Perform some modifications
root.left.value = 31  # Change a value
root.right.left.right = TreeNode(63)  # Replace a subtree
root.left.right.left = None  # Remove a subtree
root.right.right.right.right.left = TreeNode(86)  # Add a deeper node`,
      `# Hierarchical Tree Examples Code
# Example 2
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

# Create a balanced binary tree
root = TreeNode(50)

# First level
root.left = TreeNode(25)
root.right = TreeNode(75)

# Second level
root.left.left = TreeNode(12)
root.left.right = TreeNode(37)
root.right.left = TreeNode(62)
root.right.right = TreeNode(87)

# Third level
root.left.left.left = TreeNode(6)
root.left.left.right = TreeNode(18)
root.left.right.left = TreeNode(31)
root.left.right.right = TreeNode(43)
root.right.left.left = TreeNode(56)
root.right.left.right = TreeNode(68)
root.right.right.left = TreeNode(81)
root.right.right.right = TreeNode(93)

# Fourth level - left subtree
root.left.left.left.left = TreeNode(3)
root.left.left.left.right = TreeNode(9)
root.left.left.right.left = TreeNode(15)
root.left.left.right.right = TreeNode(21)
root.left.right.left.left = TreeNode(28)
root.left.right.left.right = TreeNode(34)
root.left.right.right.left = TreeNode(40)
root.left.right.right.right = TreeNode(46)

# Fourth level - right subtree
root.right.left.left.left = TreeNode(53)
root.right.left.left.right = TreeNode(59)
root.right.left.right.left = TreeNode(65)
root.right.left.right.right = TreeNode(71)
root.right.right.left.left = TreeNode(78)
root.right.right.left.right = TreeNode(84)
root.right.right.right.left = TreeNode(90)
root.right.right.right.right = TreeNode(96)

# Perform a series of transformations

# Mirror the left subtree
def mirror_tree(node):
    if node is None:
        return
    
    # Swap left and right children
    node.left, node.right = node.right, node.left
    
    # Mirror subtrees
    mirror_tree(node.left)
    mirror_tree(node.right)

# Mirror the left subtree
mirror_tree(root.left)

# Replace some nodes
root.right.left = TreeNode(60)
root.right.left.left = TreeNode(55)
root.right.left.right = TreeNode(65)

root.right.left.left.left = TreeNode(50)
root.right.left.left.left.left = TreeNode(45)

# Prune some branches
root.left.right.right = None

# Add new nodes
root.right.right.right.right = TreeNode(100)
root.right.right.right.right.left = TreeNode(98)`,
      `# Hierarchical Tree Examples Code
# Example 3
import random

class TreeNode:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

def build_random_branch(depth, max_depth, start_value):
    """Build a random branch with decreasing probability of adding nodes as depth increases"""
    if depth >= max_depth or random.random() < (depth / max_depth):
        return None
    
    node = TreeNode(start_value)
    
    # Recursive build with 70% decreasing probability
    if random.random() < 0.7 * (1 - depth/max_depth):
        node.left = build_random_branch(depth + 1, max_depth, start_value - random.randint(5, 10))
    
    if random.random() < 0.7 * (1 - depth/max_depth):
        node.right = build_random_branch(depth + 1, max_depth, start_value + random.randint(5, 10))
    
    return node

# Seed random for reproducibility
random.seed(42)

# Build a tree with maximum depth of 5
root = TreeNode(100)

# First level - deterministic
root.left = TreeNode(50)
root.right = TreeNode(150)

# Second level - deterministic
root.left.left = TreeNode(25)
root.left.right = TreeNode(75)
root.right.left = TreeNode(125)
root.right.right = TreeNode(175)

# Generate random subtrees with decreasing probability
root.left.left.left = build_random_branch(2, 5, 12)
root.left.left.right = build_random_branch(2, 5, 37)

root.left.right.left = build_random_branch(2, 5, 62)
root.left.right.right = build_random_branch(2, 5, 87)

root.right.left.left = build_random_branch(2, 5, 112)
root.right.left.right = build_random_branch(2, 5, 137)

root.right.right.left = build_random_branch(2, 5, 162)
root.right.right.right = build_random_branch(2, 5, 187)

# Manipulate some parts of the tree after generation
if root.left.left.left and root.left.left.left.right:
    root.left.left.left.right.value = 19  # Modify a value
        
if root.left.right.right:
    root.left.right.right.left = TreeNode(82)  # Add a new node
    
if root.right.left.left:   
    root.right.left.left = TreeNode(115)
    root.right.left.left.right = TreeNode(118)`,
      `# Hierarchical Tree Examples Code
# Example 4
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

# Start with a perfectly balanced tree
root = TreeNode(100)

# Build level by level
# Level 1
root.left = TreeNode(50)
root.right = TreeNode(150)

# Level 2
root.left.left = TreeNode(25)
root.left.right = TreeNode(75)
root.right.left = TreeNode(125)
root.right.right = TreeNode(175)

# Level 3
root.left.left.left = TreeNode(12)
root.left.left.right = TreeNode(37)
root.left.right.left = TreeNode(62)
root.left.right.right = TreeNode(87)
root.right.left.left = TreeNode(112)
root.right.left.right = TreeNode(137)
root.right.right.left = TreeNode(162)
root.right.right.right = TreeNode(187)

# Level 4
root.left.left.left.left = TreeNode(6)
root.left.left.left.right = TreeNode(18)
root.left.left.right.left = TreeNode(31)
root.left.left.right.right = TreeNode(43)
root.left.right.left.left = TreeNode(56)
root.left.right.left.right = TreeNode(68)
root.left.right.right.left = TreeNode(81)
root.left.right.right.right = TreeNode(93)
root.right.left.left.left = TreeNode(106)
root.right.left.left.right = TreeNode(118)
root.right.left.right.left = TreeNode(131)
root.right.left.right.right = TreeNode(143)
root.right.right.left.left = TreeNode(156)
root.right.right.left.right = TreeNode(168)
root.right.right.right.left = TreeNode(181)
root.right.right.right.right = TreeNode(193)

# Restructure some parts of the tree
root.left.right = TreeNode(70)  # Replace a subtree
root.left.right.left = TreeNode(60)
root.left.right.right = TreeNode(80)

# Add some nodes at deeper levels
root.right.left.right.left.left = TreeNode(130)
root.right.right.left.right.right = TreeNode(170)

# Perform more operations - balance a portion of the tree
if root.right.right.left.left and root.right.right.left.right:
    # Swap nodes to balance a section
    temp = root.right.right.left.left
    root.right.right.left.left = root.right.right.left.right
    root.right.right.left.right = temp`
    ],
    radialTree: [
      `# Radial Tree Examples Code
# Example 1
# Test removing children and modifying values
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.children = []
    def add_child(self, child_node):
        self.children.append(child_node)

root = TreeNode('R')
# Add level 1 children
for i in range(3):
    root.add_child(TreeNode(f'L1-{i+1}')) # L1-1, L1-2, L1-3

# Add level 2 children to L1-2
l1_node_2 = root.children[1]
for j in range(4):
    l1_node_2.add_child(TreeNode(f'L2-{j+1}')) # L2-1, L2-2, L2-3, L2-4

# Add level 2 children to L1-3
l1_node_3 = root.children[2]
for j in range(2):
    l1_node_3.add_child(TreeNode(f'L2-{j+5}')) # L2-5, L2-6


# --- Modifications ---
# 1. Remove the middle child of L1-2 (L2-2) by index
if len(l1_node_2.children) > 1:
    l1_node_2.children.pop(1) # L2-2 removed, L2-3 becomes index 1

# 2. Modify the value of the now-middle child of L1-2 (originally L2-3)
if len(l1_node_2.children) > 1:
    l1_node_2.children[1].value = 'L2-MODIFIED' # L2-3 -> L2-MODIFIED

# 3. Remove the last child of L1-3 (L2-6)
if len(l1_node_3.children) > 0:
    l1_node_3.children.pop() # L2-6 removed

# 4. Add a new child to root
root.add_child(TreeNode('L1-NEW'))`,
      `# Radial Tree Examples Code
# Example 2
# Test reordering and replacing children
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.children = []
    def add_child(self, child_node):
        self.children.append(child_node)

root = TreeNode('A')
node_b = TreeNode('B')
node_c = TreeNode('C')
node_d = TreeNode('D')
node_e = TreeNode('E')

root.add_child(node_b)
root.add_child(node_c)
root.add_child(node_d)
root.add_child(node_e)

node_c.add_child(TreeNode('C1'))
node_c.add_child(TreeNode('C2'))
node_d.add_child(TreeNode('D1'))

# --- Modifications ---
# 1. Reverse the order of root's children
root.children.reverse() # Order becomes E, D, C, B

# 2. Replace the child at index 1 (now node D) with a new node
new_node_f = TreeNode('F')
new_node_f.add_child(TreeNode('F1'))
if len(root.children) > 1:
    root.children[1] = new_node_f # Node D and its child D1 replaced by F -> F1

# 3. Modify value of original node C (now at index 2)
if len(root.children) > 2:
    root.children[2].value = 'C-MODIFIED'`,
      `# Radial Tree Examples Code
# Example 3
# Test adding a pre-built n-ary subtree
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.children = []
    def add_child(self, child_node):
        self.children.append(child_node)

# Build main tree
root = TreeNode(0)
root.add_child(TreeNode(1))
root.add_child(TreeNode(2))

# Build separate subtree
subtree_root = TreeNode(10)
subtree_root.add_child(TreeNode(11))
subtree_root.add_child(TreeNode(12))
subtree_root.children[1].add_child(TreeNode(121)) # Add grandchild

# --- Modification ---
# Replace the child at index 1 (node 2) with the pre-built subtree
if len(root.children) > 1:
    root.children[1] = subtree_root`,
      `# Radial Tree Examples Code
# Example 4
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.children = []

    def add_child(self, child_node):
        self.children.append(child_node)

# Build initial tree
root = TreeNode('Root')
child_A = TreeNode('A')
child_B = TreeNode('B') # This node will be replaced
child_C = TreeNode('C')

root.add_child(child_A)
root.add_child(child_B)
root.add_child(child_C)

# Add a child to B to make it a subtree head
child_B.add_child(TreeNode('B1'))
child_A.add_child(TreeNode('A1'))
child_C.add_child(TreeNode('C1'))

replacement_node = TreeNode('NewB')
if len(root.children) > 1:
    root.children[1] = replacement_node

if len(root.children) > 1 and root.children[1].value == 'NewB':
    root.children[1].add_child(TreeNode('NewB1'))
    root.children[1].add_child(TreeNode('NewB2'))`,
      `# Radial Tree Examples Code
# Example 5
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.children = []

    def add_child(self, child_node):
        self.children.append(child_node)

# Build initial tree
root = TreeNode('Root')
node_WithChild = TreeNode('HasChild')
node_NoChild = TreeNode('NoChild')

root.add_child(node_WithChild)    # Index 0
root.add_child(node_NoChild)     # Index 1


node_WithChild.add_child(TreeNode('Child-1'))

if len(root.children) >= 2:
   
    temp = root.children[0]
    
    root.children[0] = root.children[1]

    root.children[1] = temp`
    ],
    forceDirectedGraph: [
      `# FORCE Directed Graph Examples Code
# Example 1
chain_graph_fd = {}
nodes_fd = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7']

for node in nodes_fd:
    chain_graph_fd[node] = []

connections_fd = [
    ('V1', 'V2'), ('V2', 'V3'), ('V3', 'V4'),
    ('V4', 'V5'), ('V5', 'V6')
]
for u, v in connections_fd:
    chain_graph_fd[u].append(v)

chain_graph_fd['V2'].append('V7')

if 'V4' in chain_graph_fd.get('V3', []):
    chain_graph_fd['V3'].remove('V4')
chain_graph_fd['V3'].append('V6')

chain_graph_fd['V5'] = []

chain_graph_fd['V6'].append('V4')

if 'V3' in chain_graph_fd.get('V1', []): # Check if 'V3' was ever added to V1's list
    chain_graph_fd['V1'].remove('V3')
chain_graph_fd['V1'].append('V4')`,
      `# FORCE Directed Graph Examples Code
# Example 2
star_graph_fd = {}
nodes = ['Hub', 'LeafA', 'LeafB', 'LeafC', 'LeafD', 'Orphan1', 'Orphan2']

for node in nodes:
    star_graph_fd[node] = []

star_graph_fd['Hub'].append('LeafA')
star_graph_fd['Hub'].append('LeafB')
# Hub -> LeafC will be added later

star_graph_fd['Hub'].append('LeafC')

star_graph_fd['LeafA'].append('LeafD')

if 'LeafB' in star_graph_fd.get('Hub', []):
    star_graph_fd['Hub'].remove('LeafB')

star_graph_fd['LeafC'].append('Orphan1')

star_graph_fd['LeafD'] = ['Orphan2']`,
      `# FORCE Directed Graph Examples Code
# Example 3
sparse_graph_fd = {
    'N1': ['N2', 'N3'],
    'N2': [],
    'N3': ['N4'],
    'N4': ['N1'],
    'N5': []
}

sparse_graph_fd['N6'] = []
sparse_graph_fd['N7'] = []

sparse_graph_fd['N5'].append('N6')

if 'N3' in sparse_graph_fd.get('N1', []):
    sparse_graph_fd['N1'].remove('N3')

sparse_graph_fd['N2'].append('N7')

sparse_graph_fd['N4'] = ['N5']

sparse_graph_fd['N6'].append('N7')`
    ],
    adjacencyMatrixGraph: [
      `# adjacenty matrix code examples
# Example 1
adj_graph_mg = {}
people = ['Alice', 'Bob', 'Charlie', 'Diana', 'Elaine', 'Frank', 'Grace']

for person in people:
    adj_graph_mg[person] = []

base_friendships = [
    ('Alice', 'Bob'), ('Bob', 'Charlie'), ('Charlie', 'Diana')
]
for p1, p2 in base_friendships:
    adj_graph_mg[p1].append(p2)
    adj_graph_mg[p2].append(p1)

if 'Charlie' not in adj_graph_mg['Alice']: adj_graph_mg['Alice'].append('Charlie')
adj_graph_mg['Alice'].append('Diana')
adj_graph_mg['Alice'].append('Elaine')

if 'Alice' not in adj_graph_mg['Charlie']: adj_graph_mg['Charlie'].append('Alice')
adj_graph_mg['Charlie'].append('Elaine')
adj_graph_mg['Charlie'].append('Frank')

if 'Diana' in adj_graph_mg.get('Bob',[]): # Safe check
    adj_graph_mg['Bob'].remove('Diana')

adj_graph_mg['Frank'].append('Grace')
adj_graph_mg['Grace'].append('Frank')
adj_graph_mg['Elaine'].append('Grace')
adj_graph_mg['Grace'].append('Elaine')

adj_graph_mg['Diana'].append('Frank')`,
      `# adjacenty matrix code examples
# Example 2
nodes_cg = ['N1', 'N2', 'N3', 'N4', 'N5']
complete_graph_adj = {node: [] for node in nodes_cg}

for source in nodes_cg:
    for target in nodes_cg:
        if source != target:
            complete_graph_adj[source].append(target)

if 'N2' in complete_graph_adj.get('N1',[]): # Safe
    complete_graph_adj['N1'].remove('N2')
if 'N1' in complete_graph_adj.get('N2',[]): # Safe
    complete_graph_adj['N2'].remove('N1')

if 'N4' in complete_graph_adj.get('N3',[]): # Safe
    complete_graph_adj['N3'].remove('N4')
if 'N3' in complete_graph_adj.get('N4',[]): # Safe
    complete_graph_adj['N4'].remove('N3')

complete_graph_adj['N6'] = []
nodes_cg.append('N6')

complete_graph_adj['N1'].append('N6')
complete_graph_adj['N6'].append('N1')

complete_graph_adj['N2'].append('N6')
complete_graph_adj['N6'].append('N2')`,
      `# adjacenty matrix code examples
# Example 3
papers_adj = {
    'P1': [], 'P2': [], 'P3': [], 'P4': [],
    'P5': [], 'P6': [],
    'P7': [], 'P8': []
}
# nodes_list_adj = list(papers_adj.keys()) # This line was in your example but not used

citations_adj = [
    ('P2', 'P1'), ('P3', 'P1'), ('P4', 'P1'), ('P5', 'P1'),
    ('P3', 'P2'), ('P4', 'P2'), ('P5', 'P2'), ('P6', 'P2'),
    ('P4', 'P3'), ('P5', 'P3'), ('P6', 'P3'),
    ('P5', 'P4'), ('P6', 'P4'),
    ('P6', 'P5')
]
for citing, cited in citations_adj:
    if cited not in papers_adj[citing]: papers_adj[citing].append(cited)

papers_adj['P7'].extend(['P1', 'P2', 'P3', 'P4', 'P5'])

papers_adj['P8'].extend(['P1', 'P2', 'P6', 'P7'])
if 'P8' not in papers_adj['P1']: papers_adj['P1'].append('P8') # Ensure not duplicate
if 'P8' not in papers_adj['P3']: papers_adj['P3'].append('P8') # Ensure not duplicate

if 'P3' in papers_adj.get('P7', []): # Safe check
    papers_adj['P7'].remove('P3')`
    ]
  };
  // --- End of updated example snippets ---


  const handleCodeChange = (e) => {
    setCode(e.target.value);
    setError(null);
    setSuccessMessage(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await axios.post('http://localhost:8000/api/analyze', { code });
      if (response.data.status === 'success') {
        setSuccessMessage("Code analysis complete!");
        onAnalysisComplete();
        localStorage.setItem('lastAnalyzedCode', code);
      }
    } catch (error) {
      setError(error.response?.data?.error || 'Error analyzing code: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadExample = (category, index) => {
    if (exampleSnippets[category] && exampleSnippets[category][index]) {
      setCode(exampleSnippets[category][index]);
      setError(null);
      setSuccessMessage(null);
    }
  };

  useEffect(() => {
    const savedCode = localStorage.getItem('lastAnalyzedCode');
    if (savedCode) {
      setCode(savedCode);
    }
  }, []);

  const exampleCategories = [
    {
      label: "Try These Timeline Array Examples:",
      key: "timelineArray",
      count: 5
    },
    {
      label: "Try These Element Focused Array Examples:",
      key: "elementFocusedArray",
      count: 4
    },
    {
      label: "Try These Array Comparison Examples:",
      key: "arrayComparison",
      count: 4 // Corrected count
    },
    {
      label: "Try These Hierarchical Tree Examples:",
      key: "hierarchicalTree",
      count: 4
    },
    {
      label: "Try These Radial Tree Examples:",
      key: "radialTree",
      count: 5
    },
    {
      label: "Try These Force Directed Graph Examples:",
      key: "forceDirectedGraph",
      count: 3
    },
    {
      label: "Try These Adjacency Matrix Graph Examples:",
      key: "adjacencyMatrixGraph",
      count: 3
    }
  ];


  return (
    <div className="code-input-wrapper">
      <Form onSubmit={handleSubmit} className="d-flex flex-column h-100">
        <Form.Group className="mb-3 flex-grow-1 d-flex flex-column">
          <Form.Label className="code-input-label">
            Enter Python Code
          </Form.Label>
          <Form.Control
            as="textarea"
            value={code}
            onChange={handleCodeChange}
            className="code-editor flex-grow-1" // Ensure textarea grows
            placeholder="Enter your Python code here..."
            style={{ minHeight: '300px' }} // Ensure a good minimum height
          />
          <Form.Text className="code-help-text mt-2">
            Your code should contain array, tree, or graph data structures for visualization.
          </Form.Text>
        </Form.Group>

        <div className="example-buttons-container mb-3">
          {exampleCategories.map(category => (
            <Row key={category.key} className="mb-2 align-items-center example-row">
              <Col md="auto" className="example-label pe-2">
                <span className="fw-bold">{category.label}</span>
              </Col>
              <Col>
                <ButtonGroup size="sm">
                  {Array.from({ length: category.count }).map((_, idx) => (
                    <Button
                      key={idx}
                      variant="outline-info"
                      className="example-button"
                      onClick={() => loadExample(category.key, idx)}
                      disabled={isLoading}
                    >
                      Example {idx + 1}
                    </Button>
                  ))}
                </ButtonGroup>
              </Col>
            </Row>
          ))}
        </div>
        
        {error && (
          <Alert variant="danger" className="error-alert mt-2">
            <Alert.Heading>Analysis Error</Alert.Heading>
            <p className="mb-0">{error}</p>
          </Alert>
        )}
        
        {successMessage && (
          <Alert variant="success" className="success-alert mt-2">
            <Alert.Heading>Success!</Alert.Heading>
            <p className="mb-0">{successMessage}</p>
          </Alert>
        )}
        
        {/* Analyze Button Row - Kept separate for prominence */}
        <Row className="mt-auto pt-2"> {/* mt-auto pushes to bottom if form is flex-column h-100 */}
          <Col className="d-flex justify-content-end"> {/* Changed to justify-content-end */}
            <Button 
              variant="primary" 
              type="submit" 
              disabled={isLoading}
              className="analyze-button py-2 px-4" // Larger analyze button
              style={{minWidth: '150px'}}
            >
              {isLoading ? (
                <>
                  <Spinner
                    as="span"
                    animation="border"
                    size="sm"
                    role="status"
                    aria-hidden="true"
                    className="me-2"
                  />
                  Analyzing...
                </>
              ) : (
                <>Analyze Code</>
              )}
            </Button>
          </Col>
        </Row>
      </Form>
    </div>
  );
}

export default CodeInput;